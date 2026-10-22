// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {ProjectRegistry} from "./ProjectRegistry.sol";

/// @title SurvivalOracle
/// @notice Staked, challengeable canopy-survival attestations.
/// @dev Lifecycle of one attestation:
///        submit (locks `verifierStake`) -> Pending
///        Pending + window elapsed -> finalize -> Finalized (stake unlocked)
///        Pending + challenge within window (posts `challengeBond`) -> Challenged
///        Challenged -> arbiter resolves:
///          upheld   -> Rejected; verifier stake slashed (50% to challenger, 50% burned),
///                      bond returned, the (project, epoch) slot reopens
///          rejected -> Finalized; challenger bond slashed (50% to verifier, 50% burned)
///      MVP: the arbiter is a single address. In production this is a multisig or a dispute protocol.
contract SurvivalOracle {
    enum Status {
        None,
        Pending,
        Challenged,
        Finalized,
        Rejected
    }

    struct Attestation {
        uint256 projectId;
        uint8 epoch;
        uint16 survivalBps;
        /// @dev keccak256 of the attestation JSON file bytes.
        bytes32 evidenceHash;
        address verifier;
        uint64 submittedAt;
        Status status;
        uint256 stake;
    }

    struct Challenge {
        address challenger;
        bytes32 counterEvidenceHash;
        uint256 bond;
        uint64 challengedAt;
    }

    uint16 internal constant BPS = 10_000;
    address public constant BURN_ADDRESS = 0x000000000000000000000000000000000000dEaD;

    ProjectRegistry public immutable registry;
    address public immutable arbiter;
    uint256 public immutable verifierStake;
    uint256 public immutable challengeBond;
    uint64 public immutable challengeWindow;

    uint256 public attestationCount;
    mapping(uint256 attestationId => Attestation) internal _attestations;
    mapping(uint256 attestationId => Challenge) public challenges;
    /// @dev Live attestation for a (project, epoch); 0 if none. A Rejected one can be replaced.
    mapping(uint256 projectId => mapping(uint8 epoch => uint256 attestationId)) public currentAttestation;
    /// @dev Stake deposits plus slashing rewards and returned bonds, not locked in an attestation.
    mapping(address account => uint256) public available;

    event Staked(address indexed account, uint256 amount);
    event Unstaked(address indexed account, uint256 amount);
    event AttestationSubmitted(
        uint256 indexed attestationId,
        uint256 indexed projectId,
        uint8 epoch,
        uint16 survivalBps,
        bytes32 evidenceHash,
        address indexed verifier
    );
    event Challenged(
        uint256 indexed attestationId, address indexed challenger, bytes32 counterEvidenceHash, uint256 bond
    );
    event Resolved(
        uint256 indexed attestationId, bool challengeUpheld, address indexed winner, uint256 reward, uint256 burned
    );
    event Finalized(uint256 indexed attestationId, uint256 indexed projectId, uint8 epoch, uint16 survivalBps);

    error InvalidConfig();
    error InvalidEpoch(uint8 epoch);
    error InvalidSurvival(uint16 survivalBps);
    error EmptyEvidence();
    error ConflictOfInterest();
    error EpochAlreadyAttested(uint256 projectId, uint8 epoch, uint256 attestationId);
    error InsufficientStake(uint256 available, uint256 required);
    error NotPending(uint256 attestationId);
    error NotChallenged(uint256 attestationId);
    error ChallengeWindowClosed(uint256 attestationId);
    error ChallengeWindowOpen(uint256 attestationId);
    error WrongBond(uint256 sent, uint256 required);
    error NotArbiter();
    error ZeroAmount();
    error TransferFailed();

    constructor(
        ProjectRegistry registry_,
        address arbiter_,
        uint256 verifierStake_,
        uint256 challengeBond_,
        uint64 challengeWindow_
    ) {
        if (address(registry_) == address(0) || arbiter_ == address(0)) revert InvalidConfig();
        if (verifierStake_ == 0 || challengeBond_ == 0 || challengeWindow_ == 0) revert InvalidConfig();
        registry = registry_;
        arbiter = arbiter_;
        verifierStake = verifierStake_;
        challengeBond = challengeBond_;
        challengeWindow = challengeWindow_;
    }

    // ---------------------------------------------------------------- stake

    function stake() external payable {
        if (msg.value == 0) revert ZeroAmount();
        available[msg.sender] += msg.value;
        emit Staked(msg.sender, msg.value);
    }

    function unstake(uint256 amount) external {
        if (amount == 0) revert ZeroAmount();
        uint256 balance = available[msg.sender];
        if (balance < amount) revert InsufficientStake(balance, amount);
        available[msg.sender] = balance - amount;
        emit Unstaked(msg.sender, amount);
        _send(msg.sender, amount);
    }

    // ---------------------------------------------------------- attestations

    function submitAttestation(uint256 projectId, uint8 epoch, uint16 survivalBps, bytes32 evidenceHash)
        external
        returns (uint256 attestationId)
    {
        ProjectRegistry.Project memory project = registry.getProject(projectId);
        if (epoch >= project.epochCount) revert InvalidEpoch(epoch);
        if (survivalBps > BPS) revert InvalidSurvival(survivalBps);
        if (evidenceHash == bytes32(0)) revert EmptyEvidence();
        if (msg.sender == project.developer) revert ConflictOfInterest();

        uint256 current = currentAttestation[projectId][epoch];
        if (current != 0 && _attestations[current].status != Status.Rejected) {
            revert EpochAlreadyAttested(projectId, epoch, current);
        }

        uint256 balance = available[msg.sender];
        if (balance < verifierStake) revert InsufficientStake(balance, verifierStake);
        available[msg.sender] = balance - verifierStake;

        attestationId = ++attestationCount;
        _attestations[attestationId] = Attestation({
            projectId: projectId,
            epoch: epoch,
            survivalBps: survivalBps,
            evidenceHash: evidenceHash,
            verifier: msg.sender,
            submittedAt: uint64(block.timestamp),
            status: Status.Pending,
            stake: verifierStake
        });
        currentAttestation[projectId][epoch] = attestationId;

        emit AttestationSubmitted(attestationId, projectId, epoch, survivalBps, evidenceHash, msg.sender);
    }

    function challenge(uint256 attestationId, bytes32 counterEvidenceHash) external payable {
        Attestation storage a = _attestations[attestationId];
        if (a.status != Status.Pending) revert NotPending(attestationId);
        if (block.timestamp >= a.submittedAt + challengeWindow) revert ChallengeWindowClosed(attestationId);
        if (msg.value != challengeBond) revert WrongBond(msg.value, challengeBond);
        if (counterEvidenceHash == bytes32(0)) revert EmptyEvidence();
        if (msg.sender == a.verifier) revert ConflictOfInterest();

        a.status = Status.Challenged;
        challenges[attestationId] = Challenge({
            challenger: msg.sender,
            counterEvidenceHash: counterEvidenceHash,
            bond: msg.value,
            challengedAt: uint64(block.timestamp)
        });

        emit Challenged(attestationId, msg.sender, counterEvidenceHash, msg.value);
    }

    /// @param challengeUpheld true if the attestation was wrong.
    function resolve(uint256 attestationId, bool challengeUpheld) external {
        if (msg.sender != arbiter) revert NotArbiter();
        Attestation storage a = _attestations[attestationId];
        if (a.status != Status.Challenged) revert NotChallenged(attestationId);
        Challenge storage c = challenges[attestationId];

        address winner;
        uint256 slashed;
        if (challengeUpheld) {
            a.status = Status.Rejected;
            winner = c.challenger;
            slashed = a.stake;
            available[c.challenger] += c.bond;
        } else {
            a.status = Status.Finalized;
            winner = a.verifier;
            slashed = c.bond;
            available[a.verifier] += a.stake;
            emit Finalized(attestationId, a.projectId, a.epoch, a.survivalBps);
        }

        uint256 reward = slashed / 2;
        uint256 burned = slashed - reward;
        available[winner] += reward;

        emit Resolved(attestationId, challengeUpheld, winner, reward, burned);
        _send(BURN_ADDRESS, burned);
    }

    function finalize(uint256 attestationId) external {
        Attestation storage a = _attestations[attestationId];
        if (a.status != Status.Pending) revert NotPending(attestationId);
        if (block.timestamp < a.submittedAt + challengeWindow) revert ChallengeWindowOpen(attestationId);

        a.status = Status.Finalized;
        available[a.verifier] += a.stake;

        emit Finalized(attestationId, a.projectId, a.epoch, a.survivalBps);
    }

    // ----------------------------------------------------------------- views

    function getAttestation(uint256 attestationId) external view returns (Attestation memory) {
        return _attestations[attestationId];
    }

    /// @notice The survival value the escrow may act on, if the (project, epoch) attestation is final.
    function finalizedSurvival(uint256 projectId, uint8 epoch) external view returns (bool finalized, uint16 bps) {
        Attestation storage a = _attestations[currentAttestation[projectId][epoch]];
        if (a.status == Status.Finalized) return (true, a.survivalBps);
        return (false, 0);
    }

    function _send(address to, uint256 amount) internal {
        (bool ok,) = to.call{value: amount}("");
        if (!ok) revert TransferFailed();
    }
}
