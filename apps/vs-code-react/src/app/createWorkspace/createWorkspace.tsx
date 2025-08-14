import { XXLargeText } from '@microsoft/designer-ui';
import type { OutletContext } from '../../run-service';
import type { RootState } from '../../state/store';
import './export.less';
import { Navigation } from '../export/navigation/navigation';
import { useIntl } from 'react-intl';
import { useSelector } from 'react-redux';
import { Outlet, useOutletContext } from 'react-router-dom';

export const CreateWorkspace: React.FC = () => {
  const workflowState = useSelector((state: RootState) => state.workflow);
  const intl = useIntl();

  const intlText = {
    CREATE_WORKSPACE: intl.formatMessage({
      defaultMessage: 'Create logic app workspace',
      id: 'eagv8j',
      description: 'Create logic app workspace text.',
    }),
  };

  return (
    <div className="msla-export">
      <XXLargeText text={intlText.CREATE_WORKSPACE} className="msla-create-workspace-title" style={{ display: 'block' }} />
      <Outlet
        context={{
          baseUrl: workflowState.baseUrl,
          accessToken: workflowState.accessToken,
        }}
      />
      <Navigation />
    </div>
  );
};

export function useOutlet() {
  return useOutletContext<OutletContext>();
}
