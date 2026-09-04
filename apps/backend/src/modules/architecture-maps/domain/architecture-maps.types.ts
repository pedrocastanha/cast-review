export type ArchitectureScopeType = 'repository' | 'project';

export type CapabilityCriticality = 'low' | 'medium' | 'high' | 'critical';

export type ComponentSource = 'manual' | 'rule' | 'llm';

export type ComponentConfidence = 'confirmed' | 'inferred';

export type ComponentStatus = 'unmapped' | 'assigned' | 'rejected';

export type BoundaryKind = 'allow' | 'deny' | 'review';

export type DependencyKind = 'references' | 'imports' | 'tests' | 'http';

export type ArchitectureImpactStatus = 'exact' | 'degraded' | 'unavailable';

export interface ComponentMetrics {
  fileCount: number;
  symbolCount: number;
  internalEdges: number;
  inboundEdges: number;
  outboundEdges: number;
  providedEndpoints: number;
  consumedEndpoints: number;
}

export interface ComponentEvidence {
  kind: 'symbol' | 'edge' | 'endpoint';
  repoId: string;
  sha: string | null;
  path: string;
  line: number | null;
  symbolId: string | null;
  symbolName: string | null;
}

export interface DependencyEvidence {
  kind: DependencyKind;
  fromRepoId: string;
  fromPath: string;
  fromLine: number | null;
  fromSymbolId: string | null;
  fromSymbolName: string | null;
  toRepoId: string;
  toPath: string;
  toLine: number | null;
  toSymbolId: string | null;
  toSymbolName: string | null;
  fromSha: string | null;
  toSha: string | null;
  method: string | null;
  route: string | null;
}

export interface CapabilityDependency {
  fromCapabilityId: string;
  toCapabilityId: string;
  kinds: DependencyKind[];
  count: number;
  confidence: ComponentConfidence;
  components: Array<{ fromComponentId: string; toComponentId: string }>;
  evidence: DependencyEvidence[];
}

export interface BoundaryViolation {
  boundaryId: string;
  fromCapabilityId: string;
  toCapabilityId: string;
  boundaryKind: Extract<BoundaryKind, 'deny' | 'review'>;
  severity: 'violation' | 'warning';
  confidence: ComponentConfidence;
  count: number;
  evidence: DependencyEvidence[];
}

export interface ArchitectureCoverage {
  structural: number;
  totalComponents: number;
  assignedComponents: number;
  unmappedComponents: number;
  rejectedComponents: number;
  confirmedComponents: number;
}

export interface ArchitectureScopeRepository {
  repoId: string;
  sha: string | null;
  status: string;
  stale: boolean;
  indexed: boolean;
}

export interface ArchitectureScope {
  scopeType: ArchitectureScopeType;
  scopeRef: string;
  repositories: ArchitectureScopeRepository[];
}

export interface ArchitectureImpactCapability {
  capabilityId: string;
  name: string;
  criticality: CapabilityCriticality;
  confidence: ComponentConfidence;
  components: string[];
  files: string[];
  symbols: ComponentEvidence[];
}

export interface ArchitectureImpactReachedCapability {
  capabilityId: string;
  name: string;
  criticality: CapabilityCriticality;
  viaCapabilityId: string;
  direction: 'provides' | 'consumes';
  kinds: DependencyKind[];
  confidence: ComponentConfidence;
  count: number;
}

export interface ArchitectureImpact {
  mapId: string;
  mapName: string;
  version: number | null;
  hash: string | null;
  usedDraft: boolean;
  status: ArchitectureImpactStatus;
  changed: ArchitectureImpactCapability[];
  reached: ArchitectureImpactReachedCapability[];
  boundariesCrossed: Array<{
    boundaryId: string;
    fromCapabilityId: string;
    toCapabilityId: string;
    kind: BoundaryKind;
  }>;
  violations: BoundaryViolation[];
  unmappedFiles: string[];
  staleRepositories: string[];
  coverage: number;
  degradedReason: string | null;
}
