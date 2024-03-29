import { TrafficLightDot } from '../../card/images/dynamicsvgs/trafficlightsvgs';
import type { ValueSegment } from '../../editor';
import type { EventHandler } from '../../eventhandler';
import type { TokenPickerMode } from '../../tokenpicker';
import { AssertionButtons } from './assertionButtons';
import { AssertionField } from './assertionField';
import { Button } from '@fluentui/react-components';
import { bundleIcon, ChevronRight24Regular, ChevronRight24Filled, ChevronDown24Regular, ChevronDown24Filled } from '@fluentui/react-icons';
import { RUN_AFTER_COLORS, type Assertion, type AssertionDefintion } from '@microsoft/logic-apps-shared';
import { useState } from 'react';

const ExpandIcon = bundleIcon(ChevronRight24Filled, ChevronRight24Regular);
const CollapseIcon = bundleIcon(ChevronDown24Regular, ChevronDown24Filled);

export interface AssertionUpdateEvent {
  id: string;
  name: string;
  description: string;
  expression: Record<string, any>;
  isEditable: boolean;
}

export interface AssertionDeleteEvent {
  id: string;
}

export interface AssertionAddEvent {
  name: string;
  description: string;
  expression: Record<string, any>;
}

export type AssertionDeleteHandler = EventHandler<AssertionDeleteEvent>;
export type AssertionUpdateHandler = EventHandler<AssertionUpdateEvent>;
export type AssertionAddHandler = EventHandler<AssertionAddEvent>;
export type GetAssertionTokenPickerHandler = (
  editorId: string,
  labelId: string,
  type: string,
  tokenPickerMode?: TokenPickerMode,
  tokenClickedCallback?: (token: ValueSegment) => void
) => JSX.Element;

export interface AssertionProps {
  assertion: AssertionDefintion;
  onAssertionDelete: AssertionDeleteHandler;
  onAssertionUpdate: AssertionUpdateHandler;
  getTokenPicker: GetAssertionTokenPickerHandler;
  tokenMapping: Record<string, ValueSegment>;
  loadParameterValueFromString: (value: string) => ValueSegment[];
  validationErrors?: Record<string, string | undefined>;
  isInverted: boolean;
}

export function Assertion({
  assertion,
  onAssertionDelete,
  getTokenPicker,
  onAssertionUpdate,
  tokenMapping,
  loadParameterValueFromString,
  validationErrors,
  isInverted,
}: AssertionProps): JSX.Element {
  const [expanded, setExpanded] = useState(assertion.isEditable);
  const [isEditable, setIsEditable] = useState(assertion.isEditable);
  const [name, setName] = useState(assertion.name);
  const [description, setDescription] = useState(assertion.description);
  const [expression, setExpression] = useState(assertion.expression);

  const themeName = isInverted ? 'dark' : 'light';

  const handleEdit: React.MouseEventHandler<HTMLButtonElement> = (): void => {
    setIsEditable(true);
    setExpanded(true);
  };

  const handleDelete: React.MouseEventHandler<HTMLButtonElement> = (): void => {
    onAssertionDelete({ id: assertion.id });
  };

  const handleToggleExpand = (): void => {
    setExpanded(!expanded);
  };

  const handleUpdate = (newAssertion: Assertion) => {
    onAssertionUpdate({ ...newAssertion, id: assertion.id, isEditable: isEditable });
  };

  return (
    <div className="msla-workflow-assertion">
      <div className="msla-workflow-assertion-header">
        <Button
          appearance="subtle"
          data-testid={name + '-assertion-heading-button'}
          onClick={handleToggleExpand}
          icon={expanded ? <CollapseIcon /> : <ExpandIcon />}
        >
          {name}
        </Button>
        {Object.values(validationErrors ?? {}).filter((x) => !!x).length > 0 ? (
          <span className="msla-assertion-error-dot">
            <TrafficLightDot fill={RUN_AFTER_COLORS[themeName]['FAILED']} />
          </span>
        ) : null}
        <AssertionButtons isExpanded={expanded} isEditable={isEditable} onEdit={handleEdit} onDelete={handleDelete} />
      </div>
      <div className="msla-workflow-assertion-content">
        <AssertionField
          name={name}
          description={description}
          expression={expression}
          setName={setName}
          setDescription={setDescription}
          setExpression={setExpression}
          isEditable={isEditable}
          isExpanded={expanded}
          getTokenPicker={getTokenPicker}
          handleUpdate={handleUpdate}
          tokenMapping={tokenMapping}
          loadParameterValueFromString={loadParameterValueFromString}
          validationErrors={validationErrors}
        />
      </div>
    </div>
  );
}