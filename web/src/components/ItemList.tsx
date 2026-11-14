import type { ItemRec } from "../types";
import { Img } from "./Img";
import { gold as fmt } from "../format";

const SOURCE: Record<ItemRec["source"], string> = { ai: "AI", counter: "카운터", meta: "빌드", rule: "기본" };

export function ItemList({ items, gold, source }: { items: ItemRec[]; gold: number; source: "opendota" | "default" }) {
  return (
    <div className="panel">
      <h3>
        아이템 추천
        <span className="sub">{source === "opendota" ? "OpenDota 인기 빌드 반영" : "기본 빌드 (OpenDota 연결 안 됨)"}</span>
      </h3>
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
                <small>{it.affordable ? "구매 가능" : `${fmt(need)} 부족`}</small>
              </div>
            </li>
          );
        })}
      </ol>
    </div>
  );
}
