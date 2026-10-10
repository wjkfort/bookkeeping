import React from "react";
import { useTranslation } from "react-i18next";
import { Select } from "@radix-ui/themes";
import {
  currencySymbolFor,
  setDisplayCurrency,
  useCurrency,
} from "../../hooks/useCurrency";

/**
 * The display currency, as a visible setting.
 *
 * It lives in the header next to the language pill precisely so the two are
 * visibly different things: the pill changes words, this changes money. The
 * options come from the loaded rate table, so the control can never offer a
 * currency the app cannot convert.
 */
const CurrencySwitcher: React.FC = () => {
  const { t } = useTranslation();
  const { currencyCode, availableCurrencies } = useCurrency();

  return (
    <Select.Root value={currencyCode} onValueChange={setDisplayCurrency}>
      <Select.Trigger
        variant="surface"
        className="currency-switcher"
        aria-label={t("common.displayCurrency")}
        title={t("common.displayCurrency")}
      />
      <Select.Content className="month-picker-menu">
        {availableCurrencies.map((code) => (
          <Select.Item key={code} value={code}>
            {`${currencySymbolFor(code)}${code}`}
          </Select.Item>
        ))}
      </Select.Content>
    </Select.Root>
  );
};

export default CurrencySwitcher;
