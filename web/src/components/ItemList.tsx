import type { ItemRec, Purchase } from "../types";
import { Img } from "./Img";
import { gold as fmt } from "../format";

const SOURCE: Record<ItemRec["source"], string> = { ai: "AI", counter: "Counter", meta: "Build", rule: "Basic" };

/** "Went Battle Fury instead of Maelstrom": the latest off-plan buy and what it dropped from the list */
function OffPlan({ p, names }: { p: Purchase; names: Record<string, string> }) {
  const replaced = p.replaced.map((k) => names[k] ?? k.replace(/_/g, " "));
  return (
    <p className="offplan" role="status">
      You went <b>{p.name}</b>
      {replaced.length ? <> instead of {replaced.join(", ")}</> : null}. The list now builds around it.
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
  const lastOffPlan = [...purchases].reverse().find((p) => !p.followed);
  return (
    <div className="panel">
      <h3>
        Items
        <span className="sub">{source === "opendota" ? "Uses OpenDota popular builds" : "Default build (OpenDota unreachable)"}</span>
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
                  <span className={`tag ${it.source}`}>{SOURCE[it.source]}</span>
                </div>
                <p>{it.reason}</p>
              </div>
              <div className="item-cost">
                <span className="gold">{fmt(it.remaining)}</span>
                <small>{it.affordable ? "Can buy" : `${fmt(need)} short`}</small>
              </div>
            </li>
          );
        })}
      </ol>
    </div>
  );
}
