// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {ProjectRegistry} from "./ProjectRegistry.sol";
import {SurvivalOracle} from "./SurvivalOracle.sol";

/// @title MilestoneEscrow
/// @notice Holds a funder's money for a project and releases it per epoch according to the
///         finalized canopy-survival attestation for that epoch.
/// @dev Tranches are back-loaded, weight proportional to (epoch + 2): with 5 epochs that is
///      10 / 15 / 20 / 25 / 30 %. Release factor f(s) = clamp((s - T) / (1 - T), 0, 1), where T is
///      the project's survival threshold. The unreleased part of a tranche stays frozen in escrow;
///      each epoch is judged on its own, so a plot that recovers still earns its later tranches.
///      The funder can reclaim frozen money only after every epoch is settled.
///      Payments are pull-based: amounts are credited to `withdrawable` and claimed with `withdraw`.
contract MilestoneEscrow {
    struct Escrow {
        address funder;
        uint256 total;
        uint256 released;
        uint256 frozen;
        uint8 settledEpochs;
    }

    uint16 internal constant BPS = 10_000;

    ProjectRegistry public immutable registry;
    SurvivalOracle public immutable oracle;

    mapping(uint256 projectId => Escrow) public escrows;
    mapping(uint256 projectId => mapping(uint8 epoch => bool)) public epochSettled;
    mapping(address account => uint256) public withdrawable;

    event Funded(uint256 indexed projectId, address indexed funder, uint256 amount);
    event TrancheReleased(
        uint256 indexed projectId,
        uint8 indexed epoch,
        uint16 survivalBps,
        uint256 tranche,
        uint256 released,
        uint256 frozen
    );
    event FrozenReclaimed(uint256 indexed projectId, address indexed funder, uint256 amount);
    event Withdrawn(address indexed account, uint256 amount);

    error AlreadyFunded(uint256 projectId);
    error NotFunded(uint256 projectId);
    error ZeroAmount();
    error InvalidEpoch(uint8 epoch);
    error EpochAlreadySettled(uint256 projectId, uint8 epoch);
    error AttestationNotFinal(uint256 projectId, uint8 epoch);
    error NotFunder();
    error ProjectNotComplete(uint8 settled, uint8 epochCount);
    error NothingToWithdraw();
    error TransferFailed();

    constructor(ProjectRegistry registry_, SurvivalOracle oracle_) {
        registry = registry_;
        oracle = oracle_;
    }

    /// @notice One funding round per project in this MVP.
    function fund(uint256 projectId) external payable {
        registry.getProject(projectId);
        if (msg.value == 0) revert ZeroAmount();
        Escrow storage e = escrows[projectId];
        if (e.funder != address(0)) revert AlreadyFunded(projectId);
        e.funder = msg.sender;
        e.total = msg.value;
        emit Funded(projectId, msg.sender, msg.value);
    }

    /// @notice Settles one epoch. Callable by anyone once the epoch's attestation is final.
    function release(uint256 projectId, uint8 epoch) external returns (uint256 payout) {
        Escrow storage e = escrows[projectId];
        if (e.total == 0) revert NotFunded(projectId);
        if (epochSettled[projectId][epoch]) revert EpochAlreadySettled(projectId, epoch);

        (bool finalized, uint16 survivalBps) = oracle.finalizedSurvival(projectId, epoch);
        if (!finalized) revert AttestationNotFinal(projectId, epoch);

        ProjectRegistry.Project memory project = registry.getProject(projectId);
        uint256 tranche = trancheAmount(e.total, project.epochCount, epoch);
        payout = payoutFor(tranche, survivalBps, project.survivalThresholdBps);
        uint256 frozenPart = tranche - payout;

        epochSettled[projectId][epoch] = true;
        e.settledEpochs += 1;
        e.released += payout;
        e.frozen += frozenPart;
        withdrawable[project.developer] += payout;

        emit TrancheReleased(projectId, epoch, survivalBps, tranche, payout, frozenPart);
    }

    function reclaimFrozen(uint256 projectId) external {
        Escrow storage e = escrows[projectId];
        if (msg.sender != e.funder) revert NotFunder();
        uint8 epochCount = registry.getProject(projectId).epochCount;
        if (e.settledEpochs < epochCount) revert ProjectNotComplete(e.settledEpochs, epochCount);
        uint256 amount = e.frozen;
        if (amount == 0) revert NothingToWithdraw();
        e.frozen = 0;
        withdrawable[msg.sender] += amount;
        emit FrozenReclaimed(projectId, msg.sender, amount);
    }

    function withdraw() external {
        uint256 amount = withdrawable[msg.sender];
        if (amount == 0) revert NothingToWithdraw();
        withdrawable[msg.sender] = 0;
        emit Withdrawn(msg.sender, amount);
        (bool ok,) = msg.sender.call{value: amount}("");
        if (!ok) revert TransferFailed();
    }

    // ------------------------------------------------------------------ math

    /// @notice Amount of `total` allocated to `epoch`. Tranches of all epochs sum to exactly `total`.
    /// @dev Weight of epoch k is (k + 2); the cumulative weight up to epoch i is (i+1)(i+4)/2 and the
    ///      sum over n epochs is n(n+3)/2. Differencing floored cumulative amounts avoids dust.
    function trancheAmount(uint256 total, uint8 epochCount, uint8 epoch) public pure returns (uint256) {
        if (epoch >= epochCount) revert InvalidEpoch(epoch);
        uint256 upTo = _cumulative(total, epoch, epochCount);
        uint256 before = epoch == 0 ? 0 : _cumulative(total, epoch - 1, epochCount);
        return upTo - before;
    }

    /// @notice f(s) = clamp((s - T) / (10000 - T), 0, 1) applied to a tranche. Monotonic in s.
    function payoutFor(uint256 tranche, uint16 survivalBps, uint16 thresholdBps) public pure returns (uint256) {
        if (survivalBps <= thresholdBps) return 0;
        if (survivalBps >= BPS) return tranche;
        return tranche * (survivalBps - thresholdBps) / (BPS - thresholdBps);
    }

    /// @dev total * ((i+1)(i+4)/2) / (n(n+3)/2), with both halves cancelled.
    function _cumulative(uint256 total, uint8 epoch, uint8 epochCount) private pure returns (uint256) {
        uint256 weight = (uint256(epoch) + 1) * (uint256(epoch) + 4);
        uint256 weightSum = uint256(epochCount) * (uint256(epochCount) + 3);
        return total * weight / weightSum;
    }
}
