// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {BaseTest} from "./Base.t.sol";
import {MilestoneEscrow} from "../src/MilestoneEscrow.sol";

contract MilestoneEscrowTest is BaseTest {
    uint256 internal constant TOTAL = 1 ether;
    uint256 internal constant FIRST_TRANCHE = 0.1 ether; // 10% with 5 epochs

    // ------------------------------------------------------- demo scenarios

    function test_healthyPlot_releasesEightySevenPercent() public {
        uint256 id = _fundedProject(TOTAL);
        _attestAndFinalize(id, 0, 9600);

        uint256 payout = escrow.release(id, 0);

        assertEq(payout, FIRST_TRANCHE * 2600 / 3000);
        assertEq(payout * 10_000 / FIRST_TRANCHE, 8666); // 86.66%
        assertEq(escrow.withdrawable(developer), payout);
        (,, uint256 released, uint256 frozen,) = escrow.escrows(id);
        assertEq(released, payout);
        assertEq(frozen, FIRST_TRANCHE - payout);
    }

    function test_degradedPlot_releasesPartial() public {
        uint256 id = _fundedProject(TOTAL);
        _attestAndFinalize(id, 0, 7800);

        uint256 payout = escrow.release(id, 0);

        assertEq(payout, FIRST_TRANCHE * 800 / 3000);
        assertEq(payout * 10_000 / FIRST_TRANCHE, 2666); // 26.66%
    }

    function test_burnedPlot_releasesZero() public {
        uint256 id = _fundedProject(TOTAL);
        _attestAndFinalize(id, 0, 3100);

        uint256 payout = escrow.release(id, 0);

        assertEq(payout, 0);
        assertEq(escrow.withdrawable(developer), 0);
        (,,, uint256 frozen,) = escrow.escrows(id);
        assertEq(frozen, FIRST_TRANCHE);
    }

    /// Freezing is per epoch, not forfeiture: a plot that recovers earns its later tranches,
    /// and the funder gets the frozen remainder back once every epoch is settled.
    function test_fullLifecycle_recoveryAndReclaim() public {
        uint256 id = _fundedProject(TOTAL);
        uint16[5] memory survival = [uint16(9600), 3100, 6500, 8800, 10_000];

        uint256 paid;
        for (uint8 epoch; epoch < 5; ++epoch) {
            _attestAndFinalize(id, epoch, survival[epoch]);
            paid += escrow.release(id, epoch);
        }

        (,, uint256 released, uint256 frozen, uint8 settled) = escrow.escrows(id);
        assertEq(settled, 5);
        assertEq(released, paid);
        assertEq(released + frozen, TOTAL);
        assertGt(escrow.withdrawable(developer), 0);

        vm.prank(funder);
        escrow.reclaimFrozen(id);
        assertEq(escrow.withdrawable(funder), frozen);

        uint256 devBefore = developer.balance;
        uint256 funderBefore = funder.balance;
        vm.prank(developer);
        escrow.withdraw();
        vm.prank(funder);
        escrow.withdraw();
        assertEq(developer.balance - devBefore, released);
        assertEq(funder.balance - funderBefore, frozen);
        assertEq(address(escrow).balance, 0);
    }

    // ------------------------------------------------------------- guards

    function test_cannotReleaseBeforeFinalize() public {
        uint256 id = _fundedProject(TOTAL);
        _attest(verifier, id, 0, 9600);
        vm.expectRevert(abi.encodeWithSelector(MilestoneEscrow.AttestationNotFinal.selector, id, 0));
        escrow.release(id, 0);
    }

    function test_cannotReleaseTwice() public {
        uint256 id = _fundedProject(TOTAL);
        _attestAndFinalize(id, 0, 9600);
        escrow.release(id, 0);
        vm.expectRevert(abi.encodeWithSelector(MilestoneEscrow.EpochAlreadySettled.selector, id, 0));
        escrow.release(id, 0);
    }

    function test_release_requiresFunding() public {
        uint256 id = _register(keccak256("plot-a"), 1000);
        _attestAndFinalize(id, 0, 9600);
        vm.expectRevert(abi.encodeWithSelector(MilestoneEscrow.NotFunded.selector, id));
        escrow.release(id, 0);
    }

    function test_fund_onlyOnce() public {
        uint256 id = _fundedProject(TOTAL);
        vm.prank(funder);
        vm.expectRevert(abi.encodeWithSelector(MilestoneEscrow.AlreadyFunded.selector, id));
        escrow.fund{value: 1}(id);
    }

    function test_reclaimFrozen_onlyAfterAllEpochs() public {
        uint256 id = _fundedProject(TOTAL);
        _attestAndFinalize(id, 0, 3100);
        escrow.release(id, 0);

        vm.prank(funder);
        vm.expectRevert(abi.encodeWithSelector(MilestoneEscrow.ProjectNotComplete.selector, 1, EPOCHS));
        escrow.reclaimFrozen(id);
    }

    function test_reclaimFrozen_onlyFunder() public {
        uint256 id = _fundedProject(TOTAL);
        vm.prank(developer);
        vm.expectRevert(MilestoneEscrow.NotFunder.selector);
        escrow.reclaimFrozen(id);
    }

    function test_trancheSchedule_fiveEpochs() public view {
        uint256[5] memory expected = [uint256(0.1 ether), 0.15 ether, 0.2 ether, 0.25 ether, 0.3 ether];
        for (uint8 epoch; epoch < 5; ++epoch) {
            assertEq(escrow.trancheAmount(TOTAL, 5, epoch), expected[epoch]);
        }
    }

    // --------------------------------------------------------------- fuzz

    function testFuzz_tranchesSumToTotal(uint128 total, uint8 epochCount) public view {
        epochCount = uint8(bound(epochCount, 1, 10));
        uint256 sum;
        for (uint8 epoch; epoch < epochCount; ++epoch) {
            sum += escrow.trancheAmount(total, epochCount, epoch);
        }
        assertEq(sum, total);
    }

    /// Back-loaded up to 1 wei of rounding.
    function testFuzz_tranchesBackLoaded(uint128 total, uint8 epochCount) public view {
        epochCount = uint8(bound(epochCount, 2, 10));
        for (uint8 epoch; epoch + 1 < epochCount; ++epoch) {
            assertLe(
                escrow.trancheAmount(total, epochCount, epoch), escrow.trancheAmount(total, epochCount, epoch + 1) + 1
            );
        }
    }

    function testFuzz_releaseNeverExceedsTranche(uint128 tranche, uint16 survivalBps, uint16 thresholdBps)
        public
        view
    {
        thresholdBps = uint16(bound(thresholdBps, 0, 9999));
        assertLe(escrow.payoutFor(tranche, survivalBps, thresholdBps), tranche);
    }

    function testFuzz_releaseMonotonic(uint128 tranche, uint16 s1, uint16 s2, uint16 thresholdBps) public view {
        thresholdBps = uint16(bound(thresholdBps, 0, 9999));
        s1 = uint16(bound(s1, 0, 10_000));
        s2 = uint16(bound(s2, s1, 10_000));
        assertLe(escrow.payoutFor(tranche, s1, thresholdBps), escrow.payoutFor(tranche, s2, thresholdBps));
    }

    function testFuzz_releaseBoundaries(uint128 tranche, uint16 thresholdBps) public view {
        thresholdBps = uint16(bound(thresholdBps, 0, 9999));
        assertEq(escrow.payoutFor(tranche, thresholdBps, thresholdBps), 0);
        assertEq(escrow.payoutFor(tranche, 10_000, thresholdBps), tranche);
    }

    /// End to end through the contracts: every wei of a settled tranche is either released or frozen,
    /// and the escrow always holds exactly what it still owes.
    function testFuzz_releaseConservesFunds(uint96 amount, uint16 survivalBps, uint8 epoch) public {
        amount = uint96(bound(amount, 1, 50 ether));
        survivalBps = uint16(bound(survivalBps, 0, 10_000));
        epoch = uint8(bound(epoch, 0, EPOCHS - 1));

        uint256 id = _fundedProject(amount);
        _attestAndFinalize(id, epoch, survivalBps);
        uint256 payout = escrow.release(id, epoch);

        uint256 tranche = escrow.trancheAmount(amount, EPOCHS, epoch);
        (,, uint256 released, uint256 frozen,) = escrow.escrows(id);
        assertEq(released, payout);
        assertEq(released + frozen, tranche);
        assertEq(escrow.withdrawable(developer), payout);
        assertEq(address(escrow).balance, amount);

        if (payout > 0) {
            vm.prank(developer);
            escrow.withdraw();
            assertEq(address(escrow).balance, amount - payout);
        }
    }
}
