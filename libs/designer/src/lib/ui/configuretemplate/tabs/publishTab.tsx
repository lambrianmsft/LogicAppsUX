import type { AppDispatch, RootState } from '../../../core/state/templates/store';
import { TemplatesSection, type TemplateTabProps, type TemplatesSectionItem } from '@microsoft/designer-ui';
import constants from '../../../common/constants';
import type { IntlShape } from 'react-intl';
import { useResourceStrings } from '../resources';
import { useDispatch, useSelector } from 'react-redux';
import { useMemo } from 'react';
import { type TemplateEnvironment, updateEnvironment } from '../../../core/state/templates/templateSlice';
import type { TemplateWizardTabProps } from './model';

const TemplateSettings = () => {
  const { status } = useSelector((state: RootState) => state.template);
  const dispatch = useDispatch<AppDispatch>();
  const resources = useResourceStrings();

  const statusValues = useMemo(
    () => [
      { id: resources.DevelopmentEnvironment, label: resources.DevelopmentEnvironment, value: 'Development' },
      { id: resources.TestingEnvironment, label: resources.TestingEnvironment, value: 'Testing' },
      { id: resources.ProductionEnvironment, label: resources.ProductionEnvironment, value: 'Production' },
    ],
    [resources.DevelopmentEnvironment, resources.TestingEnvironment, resources.ProductionEnvironment]
  );

  const items: TemplatesSectionItem[] = [
    {
      label: resources.Status,
      value: statusValues.find((env) => env.value === status)?.label,
      type: 'dropdown',
      options: statusValues,
      selectedOptions: [status as string],
      onOptionSelect: (selectedOptions: string[]) => dispatch(updateEnvironment(selectedOptions[0] as TemplateEnvironment)),
    },
  ];

  return (
    <div className="msla-templates-wizard-tab-content" style={{ width: '70%' }}>
      <TemplatesSection items={items} />
    </div>
  );
};

export const publishTab = (
  intl: IntlShape,
  resources: Record<string, string>,
  { disabled, tabStatusIcon }: TemplateWizardTabProps
): TemplateTabProps => ({
  id: constants.CONFIGURE_TEMPLATE_WIZARD_TAB_NAMES.PUBLISH,
  title: resources.PublishTabLabel,
  description: intl.formatMessage({
    defaultMessage: 'The below are the settings for this template, to publish a template you need to go to Review and Publish and publish.',
    id: 'uOlHLw',
    description: 'The description for the settings tab on the configure template wizard',
  }),
  tabStatusIcon,
  disabled,
  content: <TemplateSettings />,
  // TODO: This is to be removed once the publish tab is removed
  footerContent: {
    buttonContents: [],
  },
});
