// Rebuilds everything the UI shows from contract events alone. No contract state is read here, so the
// same code serves the live chain and a recorded replay.
import type { Address, Hash } from 'viem';
import { eth, pct, shortHex } from '../lib/format';
import type { ChainEvent, Ref } from './events';

export type AttestationStatus = 'pending' | 'challenged' | 'finalized' | 'rejected';

export interface Attestation {
  id: bigint;
  projectId: bigint;
  epoch: number;
  survivalBps: number;
  evidenceHash: Hash;
  verifier: Address;
  submitted: Ref;
  status: AttestationStatus;
  challenge?: { challenger: Address; counterEvidenceHash: Hash; bond: bigint; ref: Ref };
  resolution?: { upheld: boolean; winner: Address; reward: bigint; burned: bigint; ref: Ref };
  finalized?: Ref;
}

export interface Settlement {
  epoch: number;
  survivalBps: number;
  tranche: bigint;
  released: bigint;
  frozen: bigint;
  ref: Ref;
}

export interface TimelineEntry {
  event: string;
  detail: string;
  actorRole?: string;
  actor?: Address;
  ref: Ref;
}

export interface Project {
  id: bigint;
  developer: Address;
  plotHash: Hash;
  areaHectares: number;
  epochCount: number;
  thresholdBps: number;
  cellCount: number;
  registered: Ref;
  funding?: { funder: Address; amount: bigint; ref: Ref };
  settlements: Settlement[];
  attestationIds: bigint[];
  released: bigint;
  frozen: bigint;
  reclaimed: bigint;
  timeline: TimelineEntry[];
}

export interface ChainState {
  projects: Project[];
  attestations: Map<bigint, Attestation>;
  totals: {
    escrowed: bigint;
    released: bigint;
    frozen: bigint;
    returned: bigint;
    awaiting: bigint;
    slashed: bigint;
    rejectedClaims: number;
  };
  eventCount: number;
  lastEvent?: Ref;
}

const pctText = (bps: number) => pct(bps);
const formatEth = (v: bigint) => eth(v);

export function deriveState(events: ChainEvent[], arbiter?: Address): ChainState {
  const projects = new Map<bigint, Project>();
  const attestations = new Map<bigint, Attestation>();

  const project = (id: unknown) => projects.get(id as bigint);

  for (const { name, args: a, ref } of events) {
    switch (name) {
      case 'ProjectRegistered': {
        const p: Project = {
          id: a.projectId as bigint,
          developer: a.developer as Address,
          plotHash: a.plotHash as Hash,
          areaHectares: Number(a.areaHectares),
          epochCount: Number(a.epochCount),
          thresholdBps: Number(a.survivalThresholdBps),
          cellCount: Number(a.cellCount),
          registered: ref,
          settlements: [],
          attestationIds: [],
          released: 0n,
          frozen: 0n,
          reclaimed: 0n,
          timeline: [],
        };
        projects.set(p.id, p);
        p.timeline.push({
          event: 'ProjectRegistered',
          detail: `${p.areaHectares} ha · ${p.cellCount} H3 cells · T ${pct(p.thresholdBps, 0)} · ${p.epochCount} epochs`,
          actorRole: 'developer', actor: p.developer, ref,
        });
        break;
      }
      case 'Funded': {
        const p = project(a.projectId);
        if (!p) break;
        p.funding = { funder: a.funder as Address, amount: a.amount as bigint, ref };
        p.timeline.push({
          event: 'Funded', detail: `${formatEth(a.amount as bigint)} ETH into escrow`,
          actorRole: 'funder', actor: p.funding.funder, ref,
        });
        break;
      }
      case 'AttestationSubmitted': {
        const at: Attestation = {
          id: a.attestationId as bigint,
          projectId: a.projectId as bigint,
          epoch: Number(a.epoch),
          survivalBps: Number(a.survivalBps),
          evidenceHash: a.evidenceHash as Hash,
          verifier: a.verifier as Address,
          submitted: ref,
          status: 'pending',
        };
        attestations.set(at.id, at);
        const p = project(at.projectId);
        if (!p) break;
        p.attestationIds.push(at.id);
        p.timeline.push({
          event: `AttestationSubmitted #${at.id}`,
          detail: `Epoch ${at.epoch} · ${pctText(at.survivalBps)} retained · evidence ${shortHex(at.evidenceHash)}`,
          actorRole: 'verifier', actor: at.verifier, ref,
        });
        break;
      }
      case 'Challenged': {
        const at = attestations.get(a.attestationId as bigint);
        if (!at) break;
        at.status = 'challenged';
        at.challenge = {
          challenger: a.challenger as Address,
          counterEvidenceHash: a.counterEvidenceHash as Hash,
          bond: a.bond as bigint,
          ref,
        };
        project(at.projectId)?.timeline.push({
          event: `Challenged #${at.id}`,
          detail: `Bond ${formatEth(at.challenge.bond)} ETH · counter-evidence ${shortHex(at.challenge.counterEvidenceHash)}`,
          actorRole: 'challenger', actor: at.challenge.challenger, ref,
        });
        break;
      }
      case 'Resolved': {
        const at = attestations.get(a.attestationId as bigint);
        if (!at) break;
        const upheld = a.challengeUpheld as boolean;
        at.status = upheld ? 'rejected' : 'finalized';
        at.resolution = {
          upheld, winner: a.winner as Address, reward: a.reward as bigint, burned: a.burned as bigint, ref,
        };
        if (!upheld) at.finalized = ref;
        project(at.projectId)?.timeline.push({
          event: `Resolved #${at.id}`,
          detail: upheld
            ? `Challenge upheld · ${formatEth(at.resolution.reward)} to challenger · ${formatEth(at.resolution.burned)} burned`
            : `Challenge rejected · ${formatEth(at.resolution.reward)} to verifier · ${formatEth(at.resolution.burned)} burned`,
          actorRole: 'arbiter', actor: arbiter, ref,
        });
        break;
      }
      case 'Finalized': {
        const at = attestations.get(a.attestationId as bigint);
        if (!at) break;
        at.status = 'finalized';
        at.finalized = ref;
        // After a rejected challenge the contract emits Finalized right before Resolved; that row says it.
        if (at.challenge) break;
        project(at.projectId)?.timeline.push({
          event: `Finalized #${at.id}`, detail: 'No challenge within the window', ref,
        });
        break;
      }
      case 'TrancheReleased': {
        const p = project(a.projectId);
        if (!p) break;
        const s: Settlement = {
          epoch: Number(a.epoch),
          survivalBps: Number(a.survivalBps),
          tranche: a.tranche as bigint,
          released: a.released as bigint,
          frozen: a.frozen as bigint,
          ref,
        };
        p.settlements.push(s);
        p.released += s.released;
        p.frozen += s.frozen;
        p.timeline.push({
          event: 'TrancheReleased',
          detail: `Epoch ${s.epoch} · ${formatEth(s.released)} released · ${formatEth(s.frozen)} frozen`,
          ref,
        });
        break;
      }
      case 'FrozenReclaimed': {
        const p = project(a.projectId);
        if (!p) break;
        p.reclaimed += a.amount as bigint;
        p.timeline.push({
          event: 'FrozenReclaimed', detail: `${formatEth(a.amount as bigint)} ETH back to the funder`,
          actorRole: 'funder', actor: a.funder as Address, ref,
        });
        break;
      }
    }
  }

  const list = [...projects.values()];
  const totals = {
    escrowed: 0n, released: 0n, frozen: 0n, returned: 0n, awaiting: 0n, slashed: 0n, rejectedClaims: 0,
  };
  for (const p of list) {
    const amount = p.funding?.amount ?? 0n;
    totals.escrowed += amount;
    totals.released += p.released;
    totals.frozen += p.frozen;
    totals.returned += p.reclaimed;
    totals.awaiting += amount - p.released - p.frozen;
  }
  for (const at of attestations.values()) {
    if (!at.resolution) continue;
    totals.slashed += at.resolution.reward + at.resolution.burned;
    if (at.resolution.upheld) totals.rejectedClaims += 1;
  }

  return {
    projects: list,
    attestations,
    totals,
    eventCount: events.length,
    lastEvent: events.at(-1)?.ref,
  };
}

/** The latest settled epoch, which drives a plot's headline numbers. */
export function latestSettlement(p: Project): Settlement | undefined {
  return [...p.settlements].sort((x, y) => y.epoch - x.epoch)[0];
}

export type PlotStatus = 'unsettled' | 'holding' | 'degrading' | 'lost';

/** At or above this much of the baseline canopy a plot counts as holding. */
export const HOLDING_BPS = 9500;

export function statusFor(survivalBps: number, thresholdBps: number): Exclude<PlotStatus, 'unsettled'> {
  if (survivalBps <= thresholdBps) return 'lost';
  return survivalBps >= HOLDING_BPS ? 'holding' : 'degrading';
}

export function plotStatus(p: Project): PlotStatus {
  const s = latestSettlement(p);
  return s ? statusFor(s.survivalBps, p.thresholdBps) : 'unsettled';
}
