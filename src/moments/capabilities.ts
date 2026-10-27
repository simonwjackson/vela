import { MOMENT_POSTURES, MOMENT_RULES, MOMENT_RULES_TEXT, type MomentCapabilities } from "../contract";
import schema from "../contract/moment-schema.json";
import { MOMENT_EXAMPLES } from "../ui/moment/examples";
export function momentCapabilities(enabled: boolean): MomentCapabilities {
  return { version: 1, enabled, schema, rules: { numbers: MOMENT_RULES, text: MOMENT_RULES_TEXT }, examples: MOMENT_EXAMPLES, postures: MOMENT_POSTURES };
}
