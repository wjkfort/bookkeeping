import React, { useState } from "react";
import { useTranslation } from "react-i18next";
import { Flex, Select, Text, TextField } from "@radix-ui/themes";

/**
 * Billing cycle, in the words people actually use.
 *
 * The field used to be a bare "Cycle (days)" number box, twice (subscription
 * form and the restore dialog), which asked every user to know that their
 * monthly bill is a 30-day cycle. The stored value is unchanged — a day count —
 * so the API contract and `cycle_days` are untouched; only the input changed.
 */
const PRESETS = ["7", "30", "91", "365"] as const;

/** Literal keys, not a template: a template would look unreferenced to the
 *  locale pruner and let these strings get deleted. */
const PRESET_LABELS: Record<string, string> = {
  "7": "subscriptions.cycleWeekly",
  "30": "subscriptions.cycleMonthly",
  "91": "subscriptions.cycleQuarterly",
  "365": "subscriptions.cycleYearly",
};

const CUSTOM = "custom";

interface CyclePickerProps {
  /** Days between renewals, as the string the form stores. */
  value: string;
  onChange: (days: string) => void;
  disabled?: boolean;
}

const CyclePicker: React.FC<CyclePickerProps> = ({
  value,
  onChange,
  disabled,
}) => {
  const { t } = useTranslation();
  const [pickedCustom, setPickedCustom] = useState(false);
  const isPreset = (PRESETS as readonly string[]).includes(value);
  const showDays = pickedCustom || !isPreset;

  return (
    <Flex direction="column" gap="2">
      <Select.Root
        value={showDays ? CUSTOM : value}
        onValueChange={(next) => {
          if (next === CUSTOM) {
            setPickedCustom(true);
            return;
          }
          setPickedCustom(false);
          onChange(next);
        }}
        disabled={disabled}
      >
        <Select.Trigger
          aria-label={t("subscriptions.cycle")}
          placeholder={t("subscriptions.cycle")}
          style={{ width: "100%" }}
        />
        <Select.Content>
          {PRESETS.map((days) => (
            <Select.Item key={days} value={days}>
              {t(PRESET_LABELS[days])}
            </Select.Item>
          ))}
          <Select.Item value={CUSTOM}>
            {t("subscriptions.cycleCustom")}
          </Select.Item>
        </Select.Content>
      </Select.Root>

      {showDays && (
        <label>
          <Text as="div" size="2" mb="1" className="field-hint">
            {t("subscriptions.cycleDaysLabel")}
          </Text>
          <TextField.Root
            type="number"
            min="1"
            value={value}
            onChange={(e) => onChange((e.target as HTMLInputElement).value)}
          />
        </label>
      )}
    </Flex>
  );
};

export default CyclePicker;
