// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {BaseTest} from "./Base.t.sol";
import {ProjectRegistry} from "../src/ProjectRegistry.sol";

contract ProjectRegistryTest is BaseTest {
    function test_register_storesProjectAndCells() public {
        uint256 id = _register(keccak256("plot-a"), 1000);

        ProjectRegistry.Project memory p = registry.getProject(id);
        assertEq(id, 1);
        assertEq(p.developer, developer);
        assertEq(p.plotHash, keccak256("plot-a"));
        assertEq(p.areaHectares, AREA);
        assertEq(p.epochCount, EPOCHS);
        assertEq(p.survivalThresholdBps, THRESHOLD);
        assertEq(registry.cellsOf(id).length, 24);
        assertEq(registry.projectOfPlot(keccak256("plot-a")), id);
        assertEq(registry.projectOfCell(1000), id);
        assertEq(registry.projectOfCell(1023), id);
    }

    function test_register_distinctPlotsGetDistinctIds() public {
        uint256 a = _register(keccak256("plot-a"), 1000);
        uint256 b = _register(keccak256("plot-b"), 2000);
        assertEq(a, 1);
        assertEq(b, 2);
    }

    function test_register_revertsOnSamePlotHash() public {
        _register(keccak256("plot-a"), 1000);
        vm.expectRevert(abi.encodeWithSelector(ProjectRegistry.PlotAlreadyRegistered.selector, keccak256("plot-a"), 1));
        _register(keccak256("plot-a"), 5000);
    }

    /// A polygon shifted by a few metres hashes differently but still covers registered cells.
    function test_register_revertsOnOverlappingCells() public {
        _register(keccak256("plot-a"), 1000);
        vm.expectRevert(abi.encodeWithSelector(ProjectRegistry.CellAlreadyClaimed.selector, uint64(1010), 1));
        _register(keccak256("plot-a-shifted"), 1010);
    }

    function test_register_revertsOnUnsortedCells() public {
        uint64[] memory cells = _cells(1000, 3);
        (cells[1], cells[2]) = (cells[2], cells[1]);
        vm.expectRevert(abi.encodeWithSelector(ProjectRegistry.CellsNotStrictlyAscending.selector, 2));
        registry.register(keccak256("plot-a"), cells, AREA, EPOCHS, THRESHOLD);
    }

    function test_register_revertsOnDuplicateCellInInput() public {
        uint64[] memory cells = _cells(1000, 3);
        cells[2] = cells[1];
        vm.expectRevert(abi.encodeWithSelector(ProjectRegistry.CellsNotStrictlyAscending.selector, 2));
        registry.register(keccak256("plot-a"), cells, AREA, EPOCHS, THRESHOLD);
    }

    function test_register_validatesParameters() public {
        uint64[] memory cells = _cells(1000, 3);

        vm.expectRevert(ProjectRegistry.EmptyPlotHash.selector);
        registry.register(bytes32(0), cells, AREA, EPOCHS, THRESHOLD);

        vm.expectRevert(ProjectRegistry.NoCells.selector);
        registry.register(keccak256("p"), new uint64[](0), AREA, EPOCHS, THRESHOLD);

        vm.expectRevert(ProjectRegistry.InvalidArea.selector);
        registry.register(keccak256("p"), cells, 0, EPOCHS, THRESHOLD);

        vm.expectRevert(abi.encodeWithSelector(ProjectRegistry.InvalidEpochCount.selector, 0));
        registry.register(keccak256("p"), cells, AREA, 0, THRESHOLD);

        vm.expectRevert(abi.encodeWithSelector(ProjectRegistry.InvalidEpochCount.selector, 11));
        registry.register(keccak256("p"), cells, AREA, 11, THRESHOLD);

        vm.expectRevert(abi.encodeWithSelector(ProjectRegistry.InvalidThreshold.selector, 10_000));
        registry.register(keccak256("p"), cells, AREA, EPOCHS, 10_000);
    }

    function test_getProject_revertsForUnknownId() public {
        vm.expectRevert(abi.encodeWithSelector(ProjectRegistry.UnknownProject.selector, 42));
        registry.getProject(42);
    }
}
