// TEMPORARY: writes placeholder attestation files so the contracts and demo can run before the
// oracle exists. The survival numbers are the plan's illustrative values, not measurements; every
// file says so. Delete this script once oracle/ writes real attestations to the same paths.
import { fromRoot, readJson, writeJson } from './lib/paths.ts';

interface ManifestPlot {
  id: string;
  role: 'healthy' | 'degraded' | 'burned';
  plotHash: string;
}

const manifest = readJson<{ plots: ManifestPlot[] }>(fromRoot('data/plots/manifest.json'));

const EPOCH0_SURVIVAL = { healthy: 9600, degraded: 7800, burned: 3100 } as const;

const method = {
  id: 'ndvi-histogram-v1',
  sensor: 'Sentinel-2 L2A',
  cloudMask: 'SCL classes 3, 8, 9, 10, 11 excluded',
  canopyRule: 'pixel NDVI >= canopyNdviThreshold',
  canopyNdviThreshold: 0.5,
  survival: 'canopyFraction(observation) / canopyFraction(baseline), capped at 1',
};

function attestation(plot: ManifestPlot, epoch: number, survivalRatioBps: number, note: string) {
  return {
    schema: 'proof-of-canopy/attestation@1',
    fixture: true,
    fixtureNote: note,
    plotId: plot.id,
    plotHash: plot.plotHash,
    epoch,
    baselineWindow: ['2019-01-01', '2020-12-31'],
    observationWindow: [`${2021 + epoch}-01-01`, `${2021 + epoch}-12-31`],
    method,
    metrics: {
      survivalRatioBps,
      validPixelRatio: null,
      canopyFractionBaseline: null,
      canopyFractionObserved: null,
      dnbr: null,
      firmsDetections: null,
    },
  };
}

const ILLUSTRATIVE = 'Illustrative value from the project plan, not computed from imagery.';

for (const plot of manifest.plots) {
  const path = fromRoot('data/attestations', plot.id, 'epoch-0.json');
  writeJson(path, attestation(plot, 0, EPOCH0_SURVIVAL[plot.role], ILLUSTRATIVE));
  console.log(`wrote ${path}`);

  if (plot.role === 'burned') {
    const honest = fromRoot('data/attestations', plot.id, 'epoch-1.json');
    writeJson(honest, attestation(plot, 1, 2900, ILLUSTRATIVE));
    const rogue = fromRoot('data/attestations', plot.id, 'epoch-1.rogue.json');
    writeJson(rogue, attestation(plot, 1, 9400,
      'Deliberately false claim ("the burned forest recovered") used to demonstrate challenge and slashing.'));
    console.log(`wrote ${honest}\nwrote ${rogue}`);
  }
}
