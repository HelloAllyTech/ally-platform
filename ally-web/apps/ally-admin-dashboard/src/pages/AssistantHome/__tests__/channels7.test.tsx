import React from "react";

import { fireEvent, render, screen, waitFor } from "@testing-library/react";

import { CHANNELS_COPY } from "../copy/channels";
import { CustomDomain, stepMessage } from "../sections/CustomDomain";
import { WidgetSites } from "../sections/WidgetSites";

const api = vi.hoisted(() => ({
  sites: { data: undefined as unknown, isLoading: false, isError: false },
  domains: { data: undefined as unknown, isError: false },
  add: vi.fn(),
  check: vi.fn(),
  remove: vi.fn(),
}));

vi.mock("@api", () => ({
  useGetWidgetSitesQuery: vi.fn(() => api.sites),
  useGetBotPageDomainsQuery: vi.fn(() => api.domains),
  useAddBotPageDomainMutation: vi.fn(() => [api.add, { isLoading: false }]),
  useCheckBotPageDomainMutation: vi.fn(() => [api.check, { isLoading: false }]),
  useRemoveBotPageDomainMutation: vi.fn(() => [api.remove, { isLoading: false }]),
}));

const t = CHANNELS_COPY;
const ok = <T,>(value: T) => ({ unwrap: () => Promise.resolve(value) });
const fail = (error: string) => ({ unwrap: () => Promise.reject({ data: { error } }) });

const DOMAIN = {
  id: "d1",
  host: "chat.sunrisemind.in",
  status: "pending" as const,
  records: [
    { type: "CNAME" as const, name: "chat.sunrisemind.in", value: "pages.helloally.ai" },
    {
      type: "TXT" as const,
      name: "_ally-verify.chat.sunrisemind.in",
      value: "ally-verify=abc",
    },
  ],
  lastCheck: null,
  checkedAt: null,
  verifiedAt: null,
  url: "https://chat.sunrisemind.in",
};

describe("Sites it has loaded on (stage 7)", () => {
  it("lists the sites, most recent first as ally-be sends them", () => {
    api.sites = {
      data: {
        sites: [
          {
            host: "www.sunrisemind.in",
            firstSeen: "2026-11-01T00:00:00Z",
            lastSeen: "2026-11-20T00:00:00Z",
            loadCount: 42,
          },
        ],
      },
      isLoading: false,
      isError: false,
    };
    render(<WidgetSites botId="bot-1" canEdit />);
    expect(screen.getByText("www.sunrisemind.in")).toBeInTheDocument();
    expect(screen.getByText(/About 42 loads/)).toBeInTheDocument();
  });

  it("says when it hasn't appeared anywhere, and when the list can't load", () => {
    api.sites = { data: { sites: [] }, isLoading: false, isError: false };
    const { unmount } = render(<WidgetSites botId="bot-1" canEdit />);
    expect(screen.getByText(t.sites.empty)).toBeInTheDocument();
    unmount();
    api.sites = { data: undefined, isLoading: false, isError: true };
    render(<WidgetSites botId="bot-1" canEdit />);
    expect(screen.getByRole("alert")).toHaveTextContent(t.sites.loadFailed);
  });

  it("shows nothing to a viewer (the list is for editors)", () => {
    const { container } = render(<WidgetSites botId="bot-1" canEdit={false} />);
    expect(container).toBeEmptyDOMElement();
  });
});

describe("Your own web address (stage 7)", () => {
  beforeEach(() => {
    api.add.mockReset();
    api.check.mockReset();
    api.remove.mockReset();
  });

  it("adds an address, and explains a refusal in plain words", async () => {
    api.domains = { data: { domains: [] }, isError: false };
    api.add.mockReturnValueOnce(fail("domain_shared")).mockReturnValueOnce(ok(DOMAIN));
    render(<CustomDomain botId="bot-1" canEdit />);
    const input = screen.getByLabelText(t.domain.hostLabel);
    fireEvent.change(input, { target: { value: "github.io" } });
    fireEvent.click(screen.getByRole("button", { name: t.domain.add }));
    expect(await screen.findByRole("alert")).toHaveTextContent(t.domain.errors.domain_shared);
    fireEvent.change(input, { target: { value: "chat.sunrisemind.in" } });
    fireEvent.keyDown(input, { key: "Enter" });
    await waitFor(() =>
      expect(api.add).toHaveBeenLastCalledWith({ id: "bot-1", host: "chat.sunrisemind.in" }),
    );
  });

  it("shows the two records and checks them live, step by step", async () => {
    api.domains = { data: { domains: [DOMAIN] }, isError: false };
    api.check.mockReturnValue(ok(DOMAIN));
    render(<CustomDomain botId="bot-1" canEdit />);
    expect(screen.getByTestId("dns-cname")).toHaveTextContent("pages.helloally.ai");
    expect(screen.getByTestId("dns-txt")).toHaveTextContent("_ally-verify.chat.sunrisemind.in");
    expect(screen.getByTestId("dns-txt")).toHaveTextContent("ally-verify=abc");
    expect(screen.getByTestId("custom-domain-status")).toHaveTextContent(t.domain.pending);
    fireEvent.click(screen.getByRole("button", { name: t.domain.check }));
    expect(api.check).toHaveBeenCalledWith({ id: "bot-1", domainId: "d1" });
  });

  it("says what is wrong with each record after a failed check", () => {
    api.domains = {
      data: {
        domains: [
          {
            ...DOMAIN,
            status: "failed",
            checkedAt: "2026-11-23T10:00:00Z",
            lastCheck: {
              cname: { state: "wrong", found: ["old.example.net"] },
              txt: { state: "missing", found: [] },
            },
          },
        ],
      },
      isError: false,
    };
    render(<CustomDomain botId="bot-1" canEdit />);
    expect(screen.getByTestId("dns-cname")).toHaveTextContent("old.example.net");
    expect(screen.getByTestId("dns-cname")).toHaveTextContent(
      "Change this record so it points to pages.helloally.ai",
    );
    expect(screen.getByTestId("dns-txt")).toHaveTextContent(t.domain.states.missing);
    expect(screen.getByTestId("custom-domain-status")).toHaveTextContent(t.domain.failed);
  });

  it("verified never claims it's live: it says we'll confirm when it's ready", () => {
    api.domains = {
      data: {
        domains: [
          {
            ...DOMAIN,
            status: "verified",
            lastCheck: {
              cname: { state: "ok", found: ["pages.helloally.ai"] },
              txt: { state: "ok", found: ["ally-verify=abc"] },
            },
          },
        ],
      },
      isError: false,
    };
    render(<CustomDomain botId="bot-1" canEdit />);
    expect(screen.getByTestId("custom-domain-status")).toHaveTextContent(
      "We'll confirm when your domain is ready",
    );
  });

  it("maps every step state to words", () => {
    const record = { type: "TXT" as const, value: "ally-verify=abc" };
    expect(stepMessage(undefined, record).text).toBe(t.domain.states.notChecked);
    expect(stepMessage({ state: "ok", found: [] }, record).ok).toBe(true);
    expect(stepMessage({ state: "error", found: [] }, record).text).toBe(t.domain.states.error);
    expect(stepMessage({ state: "wrong", found: ["x"] }, record).help).toBe(
      "The value must be exactly ally-verify=abc.",
    );
  });

  it("shows nothing to a viewer", () => {
    const { container } = render(<CustomDomain botId="bot-1" canEdit={false} />);
    expect(container).toBeEmptyDOMElement();
  });
});
