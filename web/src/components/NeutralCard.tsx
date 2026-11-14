import type { NeutralView } from "../types";
import { Img } from "./Img";
import { clock, itemImg } from "../format";

/** Dashboard: the neutral tier open now, what you hold, and the pick for it */
export function NeutralCard({ n, aiOn }: { n: NeutralView; aiOn: boolean }) {
  return (
    <div className="panel neutral">
      <h3>
        Neutral item
        <span className="sub">
          {n.tier ? `Tier ${n.tier}` : "No tier yet"}
          {n.nextTierAt !== null && ` · tier ${n.tier + 1} at ${clock(n.nextTierAt)}`}
        </span>
      </h3>
      {n.pick ? (
        <div className={`neutral-pick ${n.pick.held ? "held" : ""}`}>
          <Img src={itemImg(n.pick.key)} label={n.pick.name} width={44} height={32} />
          <div>
            <strong>{n.pick.name}</strong>
            <span className="tag">{n.pick.held ? "You have it" : "Pick this"}</span>
            {n.pick.reason && <p>{n.pick.reason}</p>}
          </div>
        </div>
      ) : (
        <p className="muted">
          {n.tier === 0
            ? "Tier 1 opens at 5:00."
            : aiOn
              ? "Picking from this tier on the next AI read…"
              : "Turn on AI advice for a pick. This tier's options are below."}
        </p>
      )}
      {n.holding && !n.pick?.held && (
        <p className="neutral-holding">Holding: {n.holding.name}{n.holding.tier ? ` (tier ${n.holding.tier})` : ""}</p>
      )}
      {n.tier > 0 && !n.pick && (
        <div className="neutral-options">
          {n.options.map((o) => <Img key={o.key} src={itemImg(o.key)} label={o.name} width={33} height={24} />)}
        </div>
      )}
    </div>
  );
}
