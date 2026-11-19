import React, { useEffect, useMemo, useState } from "react";

import { useSelector } from "react-redux";
import { toast } from "sonner";

import { useGetUserFeatureTogglesQuery, useSetUserFeatureTogglesMutation } from "@api";
import type { CustomLogin } from "@api";
import { ArrowDown } from "@assets";
import { ToggleSwitch } from "@components";
import { Button } from "@components/button";
import { ButtonVariant } from "@components/types";
import { en } from "@constants";
import type { RootState } from "@store";
import type { UserFeatureToggle } from "@types";
import { hasFeature } from "@utils/permissions";

import { FeatureToggleKey } from "../../constants/featureToggles";
import { UserBillingSections } from "../Billing/Users";

const t = () => en.customLogins;

/**
 * One custom login (CR1 Part B), opened in place from Users → Custom logins as an Ally admin's
 * page is: what they can use (each switch saves at once, Assistants first), then their Tokens and
 * Plan for holders of `manage_costs`.
 */
export const CustomLoginDetail: React.FC<{
  login: CustomLogin;
  onBack: () => void;
  onRemove: () => void;
}> = ({ login, onBack, onRemove }) => {
  const features = useSelector((state: RootState) => state.user.features);
  const canSeeCosts = hasFeature(features, FeatureToggleKey.MANAGE_COSTS);
  const { data, isLoading } = useGetUserFeatureTogglesQuery(login.id);
  const [save] = useSetUserFeatureTogglesMutation();
  const [toggles, setToggles] = useState<UserFeatureToggle[]>([]);
  const name = login.name || login.email;

  useEffect(() => setToggles(data ?? []), [data]);

  const ordered = useMemo(
    () => [
      ...toggles.filter(x => x.key === FeatureToggleKey.WHATSAPP_BOT),
      ...toggles.filter(x => x.key !== FeatureToggleKey.WHATSAPP_BOT),
    ],
    [toggles],
  );

  const flip = async (key: string, enabled: boolean) => {
    setToggles(previous => previous.map(x => (x.key === key ? { ...x, enabled } : x)));
    try {
      await save({ userId: login.id, toggles: [{ featureKey: key, enabled }] }).unwrap();
    } catch (error) {
      setToggles(previous => previous.map(x => (x.key === key ? { ...x, enabled: !enabled } : x)));
      toast.error((error as { data?: { message?: string } })?.data?.message || t().toggleFailed);
    }
  };

  return (
    <div
      className="py-[2px] font-primary min-w-0 md:overflow-y-auto md:h-[calc(100vh-220px)]"
      data-testid="custom-login-detail"
    >
      <div className="flex items-center gap-2 text-sm mb-4">
        <button
          type="button"
          onClick={onBack}
          className="flex items-center gap-1 min-h-[40px] md:min-h-0 text-typography-800 hover:text-typography-900"
        >
          <span className="rotate-90">
            <ArrowDown />
          </span>
          {t().back}
        </button>
      </div>

      <div className="flex flex-wrap items-start justify-between gap-3 pb-6">
        <div className="min-w-0">
          <h2 className="text-xl text-typography-900 font-secondary mb-1 break-words">{name}</h2>
          <p className="text-sm text-typography-600 break-words">
            {[login.email, login.organisation].filter(Boolean).join(" · ")}
          </p>
          <p className="text-sm text-typography-600">{t().detailSubtitle(name)}</p>
        </div>
        <Button variant={ButtonVariant.DESTRUCTIVE} onClick={onRemove}>
          {t().remove}
        </Button>
      </div>

      <div className="flex flex-col gap-8 pb-6">
        <section className="flex flex-col gap-1" data-testid="custom-login-features-section">
          <h3 className="text-base font-secondary text-typography-900">{t().whatCanTheyUse}</h3>
          <p className="text-sm text-typography-600 mb-2">{t().canUseIntro}</p>
          {isLoading ? (
            <p className="text-sm text-typography-600">{t().loading}</p>
          ) : (
            <div className="flex flex-col divide-y divide-border-light border border-border-light rounded-md">
              {ordered.map(item => {
                const isChatbots = item.key === FeatureToggleKey.WHATSAPP_BOT;
                return (
                  <div
                    key={item.key}
                    className="flex items-center gap-3 md:gap-4 px-3 md:px-4 py-3"
                  >
                    <div className="flex-1 min-w-0">
                      <p className="text-sm text-typography-900">
                        {isChatbots ? t().chatbots : item.label}
                      </p>
                      <p className="text-sm text-typography-600">
                        {isChatbots ? t().chatbotsHint : item.description}
                      </p>
                    </div>
                    <ToggleSwitch
                      enabled={item.enabled}
                      onChange={enabled => void flip(item.key, enabled)}
                      label={isChatbots ? t().chatbots : item.label}
                    />
                  </div>
                );
              })}
            </div>
          )}
        </section>

        {canSeeCosts && <UserBillingSections userId={login.id} name={name} />}
      </div>
    </div>
  );
};
