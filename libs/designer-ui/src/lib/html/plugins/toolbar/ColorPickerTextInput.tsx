import { css, useTheme } from '@fluentui/react';
import constants from '../../../constants';

type Props = Readonly<{
  'data-test-id'?: string;
  label: string;
  onChange: (val: string) => void;
  placeholder?: string;
  value: string;
}>;

export function TextInput({ label, value, onChange, placeholder = '', 'data-test-id': dataTestId }: Props): JSX.Element {
  const { isInverted } = useTheme();

  return (
    <div className="msla-colorpicker-input-wrapper">
      <label
        className="msla-colorpicker-input-label"
        style={{ color: isInverted ? constants.INVERTED_TEXT_COLOR : constants.STANDARD_TEXT_COLOR }}
      >
        {label}
      </label>
      <input
        type="text"
        className={css('msla-colorpicker-input', isInverted && 'inverted')}
        placeholder={placeholder}
        value={value}
        onChange={(e) => {
          onChange(e.target.value);
        }}
        data-test-id={dataTestId}
      />
    </div>
  );
}
