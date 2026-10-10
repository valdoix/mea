import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

// Every test run gets its own throwaway data directory.
process.env.MEA_DATA_DIR = mkdtempSync(join(tmpdir(), "mea-test-"));
process.env.MEA_DEV = "1";
process.env.MEA_MOCK_DELAY = "0";
// The studios' web research stays off the network in tests.
process.env.MEA_OFFLINE = "1";
