// Raw Valve Game State Integration payload (only fields we use, all optional).
// While playing you only get your own hero. Spectating sends all 10 under team2/team3.

export interface RawAbility {
  name?: string;
  level?: number;
  can_cast?: boolean;
  passive?: boolean;
  ability_active?: boolean;
  cooldown?: number;
  ultimate?: boolean;
}

export interface RawItem {
  name?: string; // "item_blink" | "empty"
  purchaser?: number;
  can_cast?: boolean;
  cooldown?: number;
  passive?: boolean;
  charges?: number;
}

export interface RawGsi {
  auth?: { token?: string };
  provider?: { name?: string; appid?: number; version?: number; timestamp?: number };
  map?: {
    name?: string;
    matchid?: string;
    game_time?: number;
    clock_time?: number;
    daytime?: boolean;
    nightstalker_night?: boolean;
    radiant_score?: number;
    dire_score?: number;
    game_state?: string;
    paused?: boolean;
    win_team?: string;
    roshan_state?: string;
    roshan_state_end_seconds?: number;
  };
  player?: {
    steamid?: string;
    name?: string;
    activity?: string;
    kills?: number;
    deaths?: number;
    assists?: number;
    last_hits?: number;
    denies?: number;
    kill_streak?: number;
    team_name?: string;
    gold?: number;
    gold_reliable?: number;
    gold_unreliable?: number;
    gold_from_hero_kills?: number;
    gold_from_creep_kills?: number;
    gpm?: number;
    xpm?: number;
  };
  hero?: {
    id?: number;
    name?: string;
    level?: number;
    xp?: number;
    alive?: boolean;
    respawn_seconds?: number;
    buyback_cost?: number;
    buyback_cooldown?: number;
    health?: number;
    max_health?: number;
    health_percent?: number;
    mana?: number;
    max_mana?: number;
    mana_percent?: number;
    silenced?: boolean;
    stunned?: boolean;
    disarmed?: boolean;
    hexed?: boolean;
    smoked?: boolean;
    aghanims_scepter?: boolean;
    aghanims_shard?: boolean;
    attributes_level?: number;
    talent_1?: boolean;
    talent_2?: boolean;
    talent_3?: boolean;
    talent_4?: boolean;
    talent_5?: boolean;
    talent_6?: boolean;
    talent_7?: boolean;
    talent_8?: boolean;
  };
  abilities?: Record<string, RawAbility>;
  items?: Record<string, RawItem>;
  previously?: unknown;
  added?: unknown;
}
