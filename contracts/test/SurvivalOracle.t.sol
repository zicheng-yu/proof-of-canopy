// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {BaseTest} from "./Base.t.sol";
import {SurvivalOracle} from "../src/SurvivalOracle.sol";

contract SurvivalOracleTest is BaseTest {
    address internal constant BURN = 0x000000000000000000000000000000000000dEaD;

    uint256 internal projectId;

    function setUp() public override {
        super.setUp();
        projectId = _register(keccak256("plot-a"), 1000);
    }

    function test_submit_locksStakeAndRecordsAttestation() public {
        uint256 id = _attest(verifier, projectId, 0, 9600);

        SurvivalOracle.Attestation memory a = oracle.getAttestation(id);
        assertEq(uint8(a.status), uint8(SurvivalOracle.Status.Pending));
        assertEq(a.survivalBps, 9600);
        assertEq(a.verifier, verifier);
        assertEq(a.stake, STAKE);
        assertEq(oracle.available(verifier), 0);
        assertEq(oracle.currentAttestation(projectId, 0), id);
    }

    function test_cannotAttestTwiceSameEpoch() public {
        uint256 first = _attest(verifier, projectId, 0, 9600);

        address other = makeAddr("other");
        vm.deal(other, 1 ether);
        vm.startPrank(other);
        oracle.stake{value: STAKE}();
        vm.expectRevert(abi.encodeWithSelector(SurvivalOracle.EpochAlreadyAttested.selector, projectId, 0, first));
        oracle.submitAttestation(projectId, 0, 5000, keccak256("other"));
        vm.stopPrank();
    }

    function test_cannotAttestTwiceSameEpoch_evenAfterFinalized() public {
        uint256 first = _attestAndFinalize(projectId, 0, 9600);
        vm.startPrank(verifier);
        oracle.stake{value: STAKE}();
        vm.expectRevert(abi.encodeWithSelector(SurvivalOracle.EpochAlreadyAttested.selector, projectId, 0, first));
        oracle.submitAttestation(projectId, 0, 9700, keccak256("again"));
        vm.stopPrank();
    }

    function test_submit_requiresStake() public {
        vm.prank(verifier);
        vm.expectRevert(abi.encodeWithSelector(SurvivalOracle.InsufficientStake.selector, 0, STAKE));
        oracle.submitAttestation(projectId, 0, 9600, keccak256("e"));
    }

    function test_submit_developerCannotAttestOwnProject() public {
        vm.deal(developer, 1 ether);
        vm.startPrank(developer);
        oracle.stake{value: STAKE}();
        vm.expectRevert(SurvivalOracle.ConflictOfInterest.selector);
        oracle.submitAttestation(projectId, 0, 10_000, keccak256("e"));
        vm.stopPrank();
    }

    function test_submit_validatesInput() public {
        vm.startPrank(verifier);
        oracle.stake{value: STAKE}();
        vm.expectRevert(abi.encodeWithSelector(SurvivalOracle.InvalidEpoch.selector, EPOCHS));
        oracle.submitAttestation(projectId, EPOCHS, 9600, keccak256("e"));
        vm.expectRevert(abi.encodeWithSelector(SurvivalOracle.InvalidSurvival.selector, 10_001));
        oracle.submitAttestation(projectId, 0, 10_001, keccak256("e"));
        vm.expectRevert(SurvivalOracle.EmptyEvidence.selector);
        oracle.submitAttestation(projectId, 0, 9600, bytes32(0));
        vm.stopPrank();
    }

    function test_finalize_beforeWindowReverts() public {
        uint256 id = _attest(verifier, projectId, 0, 9600);
        vm.warp(block.timestamp + WINDOW - 1);
        vm.expectRevert(abi.encodeWithSelector(SurvivalOracle.ChallengeWindowOpen.selector, id));
        oracle.finalize(id);
    }

    function test_finalize_afterWindowUnlocksStake() public {
        uint256 id = _attestAndFinalize(projectId, 0, 9600);

        assertEq(uint8(oracle.getAttestation(id).status), uint8(SurvivalOracle.Status.Finalized));
        assertEq(oracle.available(verifier), STAKE);
        (bool finalized, uint16 bps) = oracle.finalizedSurvival(projectId, 0);
        assertTrue(finalized);
        assertEq(bps, 9600);
    }

    function test_challengeWithinWindowSlashes() public {
        uint256 id = _attest(verifier, projectId, 1, 9400);
        uint256 burnBefore = BURN.balance;

        vm.warp(block.timestamp + WINDOW - 1);
        vm.prank(challenger);
        oracle.challenge{value: BOND}(id, keccak256("counter-evidence"));
        assertEq(uint8(oracle.getAttestation(id).status), uint8(SurvivalOracle.Status.Challenged));

        vm.prank(arbiter);
        oracle.resolve(id, true);

        assertEq(uint8(oracle.getAttestation(id).status), uint8(SurvivalOracle.Status.Rejected));
        // challenger: bond back + half the verifier's stake; the other half is burned
        assertEq(oracle.available(challenger), BOND + STAKE / 2);
        assertEq(oracle.available(verifier), 0);
        assertEq(BURN.balance - burnBefore, STAKE - STAKE / 2);
        (bool finalized,) = oracle.finalizedSurvival(projectId, 1);
        assertFalse(finalized);

        uint256 balanceBefore = challenger.balance;
        vm.prank(challenger);
        oracle.unstake(BOND + STAKE / 2);
        assertEq(challenger.balance - balanceBefore, BOND + STAKE / 2);
    }

    function test_challengeAfterWindowReverts() public {
        uint256 id = _attest(verifier, projectId, 0, 9600);
        vm.warp(block.timestamp + WINDOW);
        vm.prank(challenger);
        vm.expectRevert(abi.encodeWithSelector(SurvivalOracle.ChallengeWindowClosed.selector, id));
        oracle.challenge{value: BOND}(id, keccak256("late"));
    }

    function test_challenge_requiresExactBond() public {
        uint256 id = _attest(verifier, projectId, 0, 9600);
        vm.prank(challenger);
        vm.expectRevert(abi.encodeWithSelector(SurvivalOracle.WrongBond.selector, BOND - 1, BOND));
        oracle.challenge{value: BOND - 1}(id, keccak256("counter"));
    }

    function test_challenge_cannotFinalizeWhileChallenged() public {
        uint256 id = _attest(verifier, projectId, 0, 9600);
        vm.prank(challenger);
        oracle.challenge{value: BOND}(id, keccak256("counter"));
        vm.warp(block.timestamp + WINDOW);
        vm.expectRevert(abi.encodeWithSelector(SurvivalOracle.NotPending.selector, id));
        oracle.finalize(id);
    }

    function test_failedChallengeSlashesChallenger() public {
        uint256 id = _attest(verifier, projectId, 0, 9600);
        vm.prank(challenger);
        oracle.challenge{value: BOND}(id, keccak256("frivolous"));

        vm.prank(arbiter);
        oracle.resolve(id, false);

        assertEq(uint8(oracle.getAttestation(id).status), uint8(SurvivalOracle.Status.Finalized));
        assertEq(oracle.available(verifier), STAKE + BOND / 2);
        assertEq(oracle.available(challenger), 0);
        (bool finalized, uint16 bps) = oracle.finalizedSurvival(projectId, 0);
        assertTrue(finalized);
        assertEq(bps, 9600);
    }

    function test_rejectedEpochCanBeReattested() public {
        uint256 lie = _attest(verifier, projectId, 1, 9400);
        vm.prank(challenger);
        oracle.challenge{value: BOND}(lie, keccak256("counter"));
        vm.prank(arbiter);
        oracle.resolve(lie, true);

        address honest = makeAddr("honest");
        vm.deal(honest, 1 ether);
        uint256 truth = _attest(honest, projectId, 1, 2900);
        assertEq(oracle.currentAttestation(projectId, 1), truth);
    }

    function test_resolve_onlyArbiter() public {
        uint256 id = _attest(verifier, projectId, 0, 9600);
        vm.prank(challenger);
        oracle.challenge{value: BOND}(id, keccak256("counter"));
        vm.prank(challenger);
        vm.expectRevert(SurvivalOracle.NotArbiter.selector);
        oracle.resolve(id, true);
    }

    function test_unstake_cannotExceedAvailable() public {
        vm.startPrank(verifier);
        oracle.stake{value: STAKE}();
        vm.expectRevert(abi.encodeWithSelector(SurvivalOracle.InsufficientStake.selector, STAKE, STAKE + 1));
        oracle.unstake(STAKE + 1);
        vm.stopPrank();
    }
}
