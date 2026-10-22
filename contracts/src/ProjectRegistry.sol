// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

/// @title ProjectRegistry
/// @notice One on-chain identity per forest plot.
/// @dev A plot is identified two ways:
///      - `plotHash`: keccak256 of the canonical GeoJSON geometry file (exact bytes), so anyone
///        holding the file can check it;
///      - the H3 (resolution 9, ~10.5 ha) cells covering the polygon. A cell belongs to at most one
///        project, so a copy of a registered polygon shifted by a few metres is rejected too.
///      The contract cannot check that the cells match the polygon; that is recomputed off-chain.
contract ProjectRegistry {
    struct Project {
        address developer;
        bytes32 plotHash;
        uint32 areaHectares;
        uint8 epochCount;
        /// @dev Canopy-retention level at or below which a tranche releases nothing. Set per project.
        uint16 survivalThresholdBps;
        uint64 registeredAt;
    }

    uint8 public constant MAX_EPOCHS = 10;
    uint16 internal constant BPS = 10_000;

    uint256 public projectCount;
    mapping(uint256 projectId => Project) internal _projects;
    mapping(uint256 projectId => uint64[]) internal _cells;
    mapping(bytes32 plotHash => uint256 projectId) public projectOfPlot;
    mapping(uint64 cell => uint256 projectId) public projectOfCell;

    event ProjectRegistered(
        uint256 indexed projectId,
        address indexed developer,
        bytes32 indexed plotHash,
        uint32 areaHectares,
        uint8 epochCount,
        uint16 survivalThresholdBps,
        uint256 cellCount
    );

    error PlotAlreadyRegistered(bytes32 plotHash, uint256 projectId);
    error CellAlreadyClaimed(uint64 cell, uint256 projectId);
    error CellsNotStrictlyAscending(uint256 index);
    error NoCells();
    error EmptyPlotHash();
    error InvalidArea();
    error InvalidEpochCount(uint8 epochCount);
    error InvalidThreshold(uint16 thresholdBps);
    error UnknownProject(uint256 projectId);

    /// @param cells H3 cell indexes covering the plot, strictly ascending (sorted, no duplicates).
    function register(
        bytes32 plotHash,
        uint64[] calldata cells,
        uint32 areaHectares,
        uint8 epochCount,
        uint16 survivalThresholdBps
    ) external returns (uint256 projectId) {
        if (plotHash == bytes32(0)) revert EmptyPlotHash();
        if (cells.length == 0) revert NoCells();
        if (areaHectares == 0) revert InvalidArea();
        if (epochCount == 0 || epochCount > MAX_EPOCHS) revert InvalidEpochCount(epochCount);
        if (survivalThresholdBps >= BPS) revert InvalidThreshold(survivalThresholdBps);

        uint256 existing = projectOfPlot[plotHash];
        if (existing != 0) revert PlotAlreadyRegistered(plotHash, existing);

        projectId = ++projectCount;
        projectOfPlot[plotHash] = projectId;

        for (uint256 i; i < cells.length; ++i) {
            uint64 cell = cells[i];
            if (i > 0 && cell <= cells[i - 1]) revert CellsNotStrictlyAscending(i);
            uint256 owner = projectOfCell[cell];
            if (owner != 0) revert CellAlreadyClaimed(cell, owner);
            projectOfCell[cell] = projectId;
        }
        _cells[projectId] = cells;

        _projects[projectId] = Project({
            developer: msg.sender,
            plotHash: plotHash,
            areaHectares: areaHectares,
            epochCount: epochCount,
            survivalThresholdBps: survivalThresholdBps,
            registeredAt: uint64(block.timestamp)
        });

        emit ProjectRegistered(
            projectId, msg.sender, plotHash, areaHectares, epochCount, survivalThresholdBps, cells.length
        );
    }

    function getProject(uint256 projectId) external view returns (Project memory project) {
        project = _projects[projectId];
        if (project.developer == address(0)) revert UnknownProject(projectId);
    }

    function cellsOf(uint256 projectId) external view returns (uint64[] memory) {
        return _cells[projectId];
    }
}
