import React, { useMemo } from "react";
import { useTranslation } from "react-i18next";
import { Flex, Select } from "@radix-ui/themes";
import dayjs, { type Dayjs } from "dayjs";

interface MonthPickerProps {
  value: Dayjs | null;
  onChange: (date: Dayjs) => void;
  disabled?: boolean;
}

const MonthPicker: React.FC<MonthPickerProps> = ({ value, onChange, disabled }) => {
  const { i18n } = useTranslation();
  const locale = i18n.language === "zh" ? "zh-CN" : "en-US";

  const currentYear = dayjs().year();

  const years = useMemo(() => {
    const list: number[] = [];
    for (let y = currentYear - 5; y <= currentYear + 5; y++) list.push(y);
    return list;
  }, [currentYear]);

  const months = useMemo(() => {
    return Array.from({ length: 12 }, (_, i) => {
      const d = new Date(2024, i, 1);
      return {
        value: String(i + 1),
        label: new Intl.DateTimeFormat(locale, { month: "short" }).format(d),
      };
    });
  }, [locale]);

  const selectedYear = value ? value.year() : null;
  const selectedMonth = value ? value.month() + 1 : null;

  const handleYearChange = (yearStr: string) => {
    const year = parseInt(yearStr);
    const month = selectedMonth ?? 1;
    onChange(dayjs(`${year}-${String(month).padStart(2, "0")}-01`));
  };

  const handleMonthChange = (monthStr: string) => {
    const month = parseInt(monthStr);
    const year = selectedYear ?? currentYear;
    onChange(dayjs(`${year}-${String(month).padStart(2, "0")}-01`));
  };

  return (
    <Flex gap="1" align="center">
      <Select.Root
        value={selectedYear?.toString() ?? ""}
        onValueChange={handleYearChange}
        disabled={disabled}
      >
        <Select.Trigger
          variant="surface"
          placeholder={currentYear.toString()}
          style={{ minWidth: 72 }}
        />
        <Select.Content>
          {years.map((y) => (
            <Select.Item key={y} value={y.toString()}>
              {y}
            </Select.Item>
          ))}
        </Select.Content>
      </Select.Root>

      <Select.Root
        value={selectedMonth?.toString() ?? ""}
        onValueChange={handleMonthChange}
        disabled={disabled}
      >
        <Select.Trigger
          variant="surface"
          placeholder={new Intl.DateTimeFormat(locale, { month: "short" }).format(new Date())}
          style={{ minWidth: 56 }}
        />
        <Select.Content>
          {months.map((m) => (
            <Select.Item key={m.value} value={m.value}>
              {m.label}
            </Select.Item>
          ))}
        </Select.Content>
      </Select.Root>
    </Flex>
  );
};

export default MonthPicker;
