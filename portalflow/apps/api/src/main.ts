import { createApp } from "./app";
import { config } from "./config";
void createApp()
  .then((app) => app.listen(config.PORT, "0.0.0.0"))
  .catch((error) => {
    console.error(error instanceof Error ? error.message : "Startup failed");
    process.exitCode = 1;
  });
