// Shared by local agent edits and Git operations. Callers must consume the
// pending proposal once and recheck session/workspace/content before mutation.
export function assertApproval(proposal: { id: string; digest: string; expires: number } | undefined, id: string, digest: string): asserts proposal is { id: string; digest: string; expires: number } {
  if (!proposal || proposal.id !== id || proposal.digest !== digest || proposal.expires <= Date.now()) throw new Error('만료·중복·변경된 승인');
}
