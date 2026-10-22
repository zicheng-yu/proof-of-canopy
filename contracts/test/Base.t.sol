// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Test} from "forge-std/Test.sol";
import {ProjectRegistry} from "../src/ProjectRegistry.sol";
import {SurvivalOracle} from "../src/SurvivalOracle.sol";
import {MilestoneEscrow} from "../src/MilestoneEscrow.sol";

abstract contract BaseTest is Test {
    uint256 internal constant STAKE = 0.01 ether;
    uint256 internal constant BOND = 0.005 ether;
    uint64 internal constant WINDOW = 7 days;
    uint8 internal constant EPOCHS = 5;
    uint16 internal constant THRESHOLD = 7000;
    uint32 internal constant AREA = 250;

    ProjectRegistry internal registry;
    SurvivalOracle internal oracle;
    MilestoneEscrow internal escrow;

    address internal arbiter = makeAddr("arbiter");
    address internal developer = makeAddr("developer");
    address internal funder = makeAddr("funder");
    address internal verifier = makeAddr("verifier");
    address internal challenger = makeAddr("challenger");

    function setUp() public virtual {
        registry = new ProjectRegistry();
        oracle = new SurvivalOracle(registry, arbiter, STAKE, BOND, WINDOW);
        escrow = new MilestoneEscrow(registry, oracle);

        vm.deal(funder, 100 ether);
        vm.deal(verifier, 10 ether);
        vm.deal(challenger, 10 ether);
    }

    function _cells(uint64 start, uint256 n) internal pure returns (uint64[] memory cells) {
        cells = new uint64[](n);
        for (uint256 i; i < n; ++i) {
            cells[i] = start + uint64(i);
        }
    }

    function _register(bytes32 plotHash, uint64 firstCell) internal returns (uint256 projectId) {
        vm.prank(developer);
        projectId = registry.register(plotHash, _cells(firstCell, 24), AREA, EPOCHS, THRESHOLD);
    }

    function _fundedProject(uint256 amount) internal returns (uint256 projectId) {
        projectId = _register(keccak256("plot-a"), 1000);
        vm.prank(funder);
        escrow.fund{value: amount}(projectId);
    }

    function _attest(address who, uint256 projectId, uint8 epoch, uint16 survivalBps)
        internal
        returns (uint256 attestationId)
    {
        vm.startPrank(who);
        oracle.stake{value: STAKE}();
        attestationId = oracle.submitAttestation(projectId, epoch, survivalBps, keccak256(abi.encode(epoch, survivalBps)));
        vm.stopPrank();
    }

    function _attestAndFinalize(uint256 projectId, uint8 epoch, uint16 survivalBps)
        internal
        returns (uint256 attestationId)
    {
        attestationId = _attest(verifier, projectId, epoch, survivalBps);
        vm.warp(block.timestamp + WINDOW);
        oracle.finalize(attestationId);
    }
}
