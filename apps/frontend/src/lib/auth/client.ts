import { createAuthClient } from "better-auth/react";
import { emailOTPClient } from "better-auth/client/plugins";

export const authClient = createAuthClient({
  basePath: "/api/auth",
  plugins: [emailOTPClient()],
  fetchOptions: { retry: 0, timeout: 15_000 },
});
