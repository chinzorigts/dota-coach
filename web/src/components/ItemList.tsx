import type { ItemRec, Purchase } from "../types";
import { Img } from "./Img";
import { gold as fmt } from "../format";
import { useT } from "../i18n";

/** "Went Battle Fury instead of Maelstrom": the latest off-plan buy and what it dropped from the list */
function OffPlan({ p, names }: { p: Purchase; names: Record<string, string> }) {
  const t = useT();
  const replaced = p.replaced.map((k) => names[k] ?? k.replace(/_/g, " "));
  return (
    <p className="offplan" role="status">
      {t.offPlanWent}<b>{p.name}</b>
      {replaced.length ? t.offPlanInstead(replaced.join(", ")) : null}{t.offPlanAfter}
    </p>
  );
}

export function ItemList({ items, gold, source, purchases = [], names = {} }: {
  items: ItemRec[];
  gold: number;
  source: "opendota" | "default";
  purchases?: Purchase[];
  names?: Record<string, string>;
}) {
  const t = useT();
  const lastOffPlan = [...purchases].reverse().find((p) => !p.followed);
  return (
    <div className="panel">
      <h3>
        {t.items}
        <span className="sub">{source === "opendota" ? t.itemsOpenDota : t.itemsDefault}</span>
      </h3>
      {lastOffPlan && <OffPlan p={lastOffPlan} names={names} />}
      <ol className="items">
        {items.map((it) => {
          const need = Math.max(0, it.remaining - gold);
          return (
            <li key={it.key} className={it.affordable ? "ready" : ""}>
              <Img src={it.img} label={it.name} width={50} height={36} />
              <div className="item-main">
                <div className="item-top">
                  <strong>{it.name}</strong>
                  <span className={`tag ${it.source}`}>{t.itemSource[it.source]}</span>
                </div>
                <p>{it.reason}</p>
              </div>
              <div className="item-cost">
                <span className="gold">{fmt(it.remaining)}</span>
                <small>{it.affordable ? t.canBuy : t.short(fmt(need))}</small>
              </div>
            </li>
          );
        })}
      </ol>
    </div>
  );
}
