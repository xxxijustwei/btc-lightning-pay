import { DayPicker } from "@daypicker/react";
import { useForm } from "@tanstack/react-form";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { format, parseISO } from "date-fns";
import { atom, Provider, useAtom } from "jotai";
import { MotionConfig, motion } from "motion/react";
import { parseAsString, useQueryState } from "nuqs";
import { NuqsTestingAdapter } from "nuqs/adapters/testing";
import QRCode from "qrcode";
import { renderToString } from "react-dom/server";
import { expect, test, vi } from "vite-plus/test";
import { z } from "zod";

test("TanStack Form accepts Zod validation before submitting", async () => {
  const submit = vi.fn();
  function FormExample() {
    const form = useForm({
      defaultValues: { text: "" },
      validators: { onSubmit: z.object({ text: z.string().min(1) }) },
      onSubmit: ({ value }) => submit(value),
    });
    return (
      <form
        onSubmit={(event) => {
          event.preventDefault();
          void form.handleSubmit();
        }}
      >
        <form.Field name="text">
          {(field) => (
            <input
              aria-label="Text"
              value={field.state.value}
              onChange={(event) => field.handleChange(event.target.value)}
            />
          )}
        </form.Field>
        <button type="submit">Submit</button>
      </form>
    );
  }
  render(<FormExample />);
  const user = userEvent.setup();
  await user.click(screen.getByRole("button", { name: "Submit" }));
  expect(submit).not.toHaveBeenCalled();
  await user.type(screen.getByRole("textbox", { name: "Text" }), "example");
  await user.click(screen.getByRole("button", { name: "Submit" }));
  await waitFor(() => expect(submit).toHaveBeenCalledWith({ text: "example" }));
});

test("client state is scoped to its Provider while URL state uses the nuqs adapter", async () => {
  const countAtom = atom(0);
  const onUrlUpdate = vi.fn();
  function StateExample() {
    const [count, setCount] = useAtom(countAtom);
    const [view, setView] = useQueryState("view", parseAsString.withDefault("list"));
    return (
      <button
        onClick={() => {
          setCount(count + 1);
          void setView("detail");
        }}
      >
        {view}: {count}
      </button>
    );
  }
  const { unmount } = render(
    <Provider>
      <NuqsTestingAdapter onUrlUpdate={onUrlUpdate}>
        <StateExample />
      </NuqsTestingAdapter>
    </Provider>,
  );
  await userEvent.setup().click(screen.getByRole("button", { name: "list: 0" }));
  await waitFor(() => expect(onUrlUpdate).toHaveBeenCalled());
  expect(onUrlUpdate.mock.calls[0][0].searchParams.get("view")).toBe("detail");
  unmount();
  render(
    <Provider>
      <NuqsTestingAdapter>
        <StateExample />
      </NuqsTestingAdapter>
    </Provider>,
  );
  expect(screen.getByRole("button", { name: "list: 0" })).toBeTruthy();
});

test("date, motion and QR libraries can render without a browser canvas", async () => {
  const date = parseISO("2026-11-17T09:30");
  const html = renderToString(
    <MotionConfig reducedMotion="user">
      <motion.div initial={false}>
        <DayPicker mode="single" month={date} selected={date} />
      </motion.div>
    </MotionConfig>,
  );
  expect(html).toContain("November");
  expect(format(date, "yyyy-MM-dd HH:mm")).toBe("2026-11-17 09:30");
  const svg = await QRCode.toString("development-example", { type: "svg" });
  expect(svg).toContain("<svg");
  expect(svg).toContain("<path");
});
