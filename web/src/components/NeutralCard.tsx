import type { NeutralView } from "../types";
import { Img } from "./Img";
import { clock, itemImg } from "../format";
import { useT } from "../i18n";

/** Dashboard: the neutral tier open now, what you hold, and the pick for it */
export function NeutralCard({ n, aiOn }: { n: NeutralView; aiOn: boolean }) {
  const t = useT();
  return (
    <div className="panel neutral">
      <h3>
        {t.neutralItem}
        <span className="sub">
          {n.tier ? t.tier(n.tier) : t.noTier}
          {n.nextTierAt !== null && t.nextTierAt(n.tier + 1, clock(n.nextTierAt))}
        </span>
      </h3>
      {n.pick ? (
        <div className={`neutral-pick ${n.pick.held ? "held" : ""}`}>
          <Img src={itemImg(n.pick.key)} label={n.pick.name} width={44} height={32} />
          <div>
            <strong>{n.pick.name}</strong>
            <span className="tag">{n.pick.held ? t.youHaveIt : t.pickThis}</span>
            {n.pick.reason && <p>{n.pick.reason}</p>}
          </div>
        </div>
      ) : (
        <p className="muted">
          {n.tier === 0
            ? t.tier1Opens
            : aiOn
              ? t.neutralPicking
              : t.neutralTurnOnAi}
        </p>
      )}
      {n.holding && !n.pick?.held && (
        <p className="neutral-holding">{t.holding(n.holding.name, n.holding.tier)}</p>
      )}
      {n.tier > 0 && !n.pick && (
        <div className="neutral-options">
          {n.options.map((o) => <Img key={o.key} src={itemImg(o.key)} label={o.name} width={33} height={24} />)}
        </div>
      )}
    </div>
  );
}
