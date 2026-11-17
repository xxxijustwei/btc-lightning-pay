import { handler } from "./app";

export default {
  fetch(request) {
    return handler(request);
  },
} satisfies ExportedHandler<Env>;
