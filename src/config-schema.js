// src/config-schema.js
//
// Single source of truth for the composed config schema: the tab-defaults
// assembly + buildSchema call shared by server boot and the snapshot tool, so
// the checked-in shape can never drift from what the server actually loads.

import { buildSchema } from "./config.js";
import { defaults as loopsDefaults } from "./tabs/loops.js";
import { defaults as pullsDefaults } from "./tabs/pulls.js";
import { defaults as ticketsDefaults } from "./tabs/tickets.js";
import { defaults as tasksDefaults } from "./tabs/tasks.js";

export const tabDefaults = {
  loops: loopsDefaults,
  pulls: pullsDefaults,
  tickets: ticketsDefaults,
  tasks: tasksDefaults,
};

export function buildConfigSchema() {
  return buildSchema(tabDefaults);
}
