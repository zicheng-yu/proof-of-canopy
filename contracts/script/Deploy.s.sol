// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Script} from "forge-std/Script.sol";
import {ProjectRegistry} from "../src/ProjectRegistry.sol";
import {SurvivalOracle} from "../src/SurvivalOracle.sol";
import {MilestoneEscrow} from "../src/MilestoneEscrow.sol";

/// Deploys the three contracts and writes their addresses to deployments/<chainId>.json.
/// Env: DEPLOYER_KEY (required), ARBITER (default: deployer), VERIFIER_STAKE (wei, default 0.01 ether),
///      CHALLENGE_BOND (wei, default 0.005 ether), CHALLENGE_WINDOW (seconds, default 60).
contract Deploy is Script {
    function run() external returns (ProjectRegistry registry, SurvivalOracle oracle, MilestoneEscrow escrow) {
        uint256 deployerKey = vm.envUint("DEPLOYER_KEY");
        address arbiter = vm.envOr("ARBITER", vm.addr(deployerKey));
        uint256 stake = vm.envOr("VERIFIER_STAKE", uint256(0.01 ether));
        uint256 bond = vm.envOr("CHALLENGE_BOND", uint256(0.005 ether));
        uint64 window = uint64(vm.envOr("CHALLENGE_WINDOW", uint256(60)));
        uint256 startBlock = block.number;

        vm.startBroadcast(deployerKey);
        registry = new ProjectRegistry();
        oracle = new SurvivalOracle(registry, arbiter, stake, bond, window);
        escrow = new MilestoneEscrow(registry, oracle);
        vm.stopBroadcast();

        string memory key = "deployment";
        vm.serializeUint(key, "chainId", block.chainid);
        vm.serializeUint(key, "startBlock", startBlock);
        vm.serializeAddress(key, "arbiter", arbiter);
        vm.serializeUint(key, "verifierStake", stake);
        vm.serializeUint(key, "challengeBond", bond);
        vm.serializeUint(key, "challengeWindow", window);
        vm.serializeAddress(key, "ProjectRegistry", address(registry));
        vm.serializeAddress(key, "SurvivalOracle", address(oracle));
        string memory json = vm.serializeAddress(key, "MilestoneEscrow", address(escrow));
        vm.writeJson(json, string.concat(vm.projectRoot(), "/../deployments/", vm.toString(block.chainid), ".json"));
    }
}
