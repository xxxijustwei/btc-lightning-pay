import { queryOptions } from "@tanstack/react-query";
import { getCurrentUser } from "./functions";

export const authQueryOptions = () =>
  queryOptions({
    queryKey: ["auth", "user"],
    queryFn: ({ signal }) => getCurrentUser({ signal }),
    staleTime: 0,
    retry: false,
  });
