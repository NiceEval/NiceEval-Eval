# Local development

The deterministic local policy backend uses the `memory://policy` endpoint. Refund and warranty
answers also pass through the local compliance service at `memory://compliance`. Production
deployments replace both values with service URLs supplied by the environment.
