import { z } from "zod";
import type { Collector, TrendItem } from "./types";
import { requireKey, requireRegion } from "./util";

// App access token (client credentials), then the top games by live viewers.
const Token = z.object({ access_token: z.string().min(1) });
const Games = z.object({
  data: z.array(z.object({ id: z.string(), name: z.string() })),
});

export const twitch: Collector = {
  id: "twitch",
  async fetch(region, { http, env }) {
    requireRegion("twitch", region, ["global"]);
    const clientId = requireKey(env, "TWITCH_CLIENT_ID");
    const clientSecret = requireKey(env, "TWITCH_CLIENT_SECRET");
    const token = Token.parse(
      await http.postFormJson("https://id.twitch.tv/oauth2/token", {
        client_id: clientId,
        client_secret: clientSecret,
        grant_type: "client_credentials",
      }),
    );
    const games = Games.parse(
      await http.getJson("https://api.twitch.tv/helix/games/top?first=25", {
        headers: { "Client-Id": clientId, Authorization: `Bearer ${token.access_token}` },
      }),
    );
    return games.data.map(
      (game, index): TrendItem => ({
        source: "twitch",
        region,
        rank: index + 1,
        title: game.name,
        url: `https://www.twitch.tv/search?term=${encodeURIComponent(game.name)}`,
      }),
    );
  },
};
