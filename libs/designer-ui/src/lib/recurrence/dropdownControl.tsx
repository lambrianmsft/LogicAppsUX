import type { IDropdownOption, IDropdownStyles } from '@fluentui/react';
import { css, Dropdown, FontSizes } from '@fluentui/react';
import { useMemo, useState } from 'react';
import { Label } from '../label';

export const DropdownType = {
  Frequency: 'frequency',
  Timezone: 'timezone',
  Days: 'days',
  Hours: 'hours',
} as const;
export type DropdownType = (typeof DropdownType)[keyof typeof DropdownType];

const dropdownStyle: Partial<IDropdownStyles> = {
  caretDown: {
    fontSize: FontSizes.icon,
    lineHeight: '24px',
    right: '10px',
  },
  dropdownOptionText: {
    fontSize: FontSizes.medium,
  },
  title: {
    border: '1px solid #989898',
    fontSize: FontSizes.medium,
    height: '28px',
    lineHeight: '26px',
  },
  root: {
    height: '28px',
  },
};

const timezoneDropdownStyles: Partial<IDropdownStyles> = {
  ...dropdownStyle,
  callout: {
    maxWidth: '430px',
  },
};

const hoursDropdownStyles: Partial<IDropdownStyles> = {
  ...dropdownStyle,
  callout: {
    maxWidth: '100px',
  },
};

interface DropdownProps {
  label: string;
  required: boolean;
  selectedKey?: string | undefined;
  selectedKeys?: string[] | undefined;
  options: IDropdownOption<any>[];
  placeholder: string;
  onChange: (selectedValues: string[] | string | number[]) => void;
  isMultiSelect?: boolean;
  className?: string;
  readOnly?: boolean;
  type?: DropdownType;
}

export const DropdownControl = ({
  label,
  required,
  selectedKey,
  selectedKeys,
  placeholder,
  options,
  onChange,
  readOnly,
  isMultiSelect,
  className,
  type,
}: DropdownProps): JSX.Element => {
  const isHoursDropDown = useMemo(() => type === DropdownType.Hours, [type]);
  const [selectedOption, setSelectedOption] = useState<string | undefined>(selectedKey);
  const [selectedOptions, setSelectedOptions] = useState<string[]>(selectedKeys ?? []);
  const handleOptionSelect = (_: React.FormEvent, option?: IDropdownOption<string>) => {
    if (isMultiSelect) {
      const newKeys = option?.selected
        ? [...selectedOptions, option.key as string]
        : selectedOptions.filter((key: string) => key !== option?.key);

      if (isHoursDropDown) {
        const newKeysAsIntegers = newKeys.map((key) => Number.parseInt(key, 10)).filter(Number.isFinite);
        setSelectedOptions(newKeys);
        onChange(newKeysAsIntegers);
      } else {
        setSelectedOptions(newKeys);
        onChange(newKeys);
      }
    } else if (option) {
      setSelectedOption(option.key as string);
      onChange(option.key as string);
    }
  };

  return (
    <div className={className}>
      <div className="msla-input-parameter-label">
        <Label text={label} isRequiredField={required} />
      </div>
      <Dropdown
        styles={type === DropdownType.Timezone ? timezoneDropdownStyles : isHoursDropDown ? hoursDropdownStyles : dropdownStyle}
        selectedKey={selectedOption}
        selectedKeys={isMultiSelect ? selectedOptions : undefined}
        placeholder={placeholder}
        disabled={readOnly}
        ariaLabel={label}
        options={options}
        required={required}
        className={css('msla-authentication-dropdown')}
        multiSelect={isMultiSelect}
        onChange={handleOptionSelect}
      />
    </div>
  );
};
