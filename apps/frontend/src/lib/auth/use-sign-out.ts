import { useQueryClient } from "@tanstack/react-query";
import { useRouter } from "@tanstack/react-router";
import { useRef, useState } from "react";
import { authClient } from "./client";

/** Signs out once, clears every cached query and route, then returns to the sign-in page. */
export function useSignOut() {
  const queryClient = useQueryClient();
  const router = useRouter();
  const lock = useRef(false);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState(false);
  async function signOut() {
    if (lock.current) return;
    lock.current = true;
    setPending(true);
    setError(false);
    try {
      const result = await authClient.signOut();
      if (result.error) {
        setError(true);
        return;
      }
      await queryClient.cancelQueries();
      queryClient.clear();
      router.clearCache();
      await router.navigate({ to: "/sign-in", replace: true });
    } catch {
      setError(true);
    } finally {
      lock.current = false;
      setPending(false);
    }
  }
  return { signOut, pending, error };
}
