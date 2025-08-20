/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/
import { RadioGroup, Radio } from '@fluentui/react-components';
import { useCreateWorkspaceStyles } from '../createWorkspaceStyles';
import type { RootState } from '../../../state/store';
import type { CreateWorkspaceState } from '../../../state/createWorkspace/createWorkspaceSlice';
import { setOpenBehavior } from '../../../state/createWorkspace/createWorkspaceSlice';
import { useIntl } from 'react-intl';
import { useSelector, useDispatch } from 'react-redux';
import { XLargeText } from '@microsoft/designer-ui';

export const OpenBehaviorStep: React.FC = () => {
  const dispatch = useDispatch();
  const intl = useIntl();
  const styles = useCreateWorkspaceStyles();
  const createWorkspaceState = useSelector((state: RootState) => state.createWorkspace) as CreateWorkspaceState;
  const { openBehavior } = createWorkspaceState;

  const intlText = {
    TITLE: intl.formatMessage({
      defaultMessage: 'Open Behavior',
      id: 'raYkno',
      description: 'Open behavior step title',
    }),
    DESCRIPTION: intl.formatMessage({
      defaultMessage: 'Choose how to open the workspace after creation',
      id: 'YsOomw',
      description: 'Open behavior step description',
    }),
    OPEN_IN_CURRENT_WINDOW: intl.formatMessage({
      defaultMessage: 'Open in current window',
      id: 'ApVVe2',
      description: 'Open in current window option',
    }),
    OPEN_IN_NEW_WINDOW: intl.formatMessage({
      defaultMessage: 'Open in new window',
      id: 'MOFY4h',
      description: 'Open in new window option',
    }),
    ADD_TO_WORKSPACE: intl.formatMessage({
      defaultMessage: 'Add to workspace',
      id: 'pAhhN6',
      description: 'Add to workspace option',
    }),
  };

  const handleOpenBehaviorChange = (event: React.FormEvent<HTMLDivElement>, data: { value: string }) => {
    dispatch(setOpenBehavior(data.value));
  };

  return (
    <div className={styles.formSection}>
      <XLargeText text={intlText.TITLE} className={styles.sectionTitle} style={{ display: 'block' }} />
      <div className={styles.radioGroupContainer}>
        <RadioGroup value={openBehavior} onChange={handleOpenBehaviorChange} className={styles.radioGroup}>
          <Radio value="openInCurrentWindow" label={intlText.OPEN_IN_CURRENT_WINDOW} className={styles.radioOption} />
          <Radio value="openInNewWindow" label={intlText.OPEN_IN_NEW_WINDOW} className={styles.radioOption} />
          <Radio value="addToWorkspace" label={intlText.ADD_TO_WORKSPACE} className={styles.radioOption} />
        </RadioGroup>
      </div>
    </div>
  );
};
