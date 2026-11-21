export type SessionWindow = {
  status: string;
  opensAt: Date | null;
  closesAt: Date | null;
};
export function sessionAcceptsDecisions(
  session: SessionWindow,
  now = new Date(),
): boolean {
  const active =
    session.status === "OPEN" ||
    (session.status === "SCHEDULED" && !!session.opensAt);
  return (
    active &&
    (!session.opensAt || now >= session.opensAt) &&
    (!session.closesAt || now < session.closesAt)
  );
}
export function guestAccessValid(
  p: { tokenExpiresAt: Date; revokedAt: Date | null },
  now = new Date(),
) {
  return !p.revokedAt && p.tokenExpiresAt > now;
}
