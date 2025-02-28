import { useEffect, FC } from 'react';
import { Step, Field, Form, Switch, Select, Loading, Message, Balloon, Icon } from '@alifd/next';
import XtermTerminal from '@/components/XtermTerminal';
import xtermManager from '@/utils/xtermManager';
import { STEP_STATUS_ICON } from '@/constants';
import { ipcRenderer, IpcRendererEvent } from 'electron';
import store from '../../store';
import InstallResult from '../InstallResult';
import styles from './index.module.scss';

interface IInstallStep {
  managerName: string;
  INSTALL_NODE_CHANNEL: string;
  INSTALL_PROCESS_STATUS_CHANNEL: string;
  goBack: () => void;
}

const defaultValues = { reinstallGlobalDeps: true };

const InstallStep: FC<IInstallStep> = ({ managerName, INSTALL_NODE_CHANNEL, INSTALL_PROCESS_STATUS_CHANNEL, goBack }) => {
  const [state, dispatchers] = store.useModel('node');
  const { nodeInstallFormValue, currentStep, nodeVersions, nodeInstallStatus, nodeInstallVisible } = state;
  const effectsLoading = store.useModelEffectsLoading('node');
  const effectsErrors = store.useModelEffectsError('node');

  useEffect(() => {
    if (effectsErrors.getNodeVersions.error) {
      Message.error(effectsErrors.getNodeVersions.error.message);
    }
  }, [effectsErrors.getNodeVersions.error]);

  useEffect(() => {
    if (effectsErrors.getNodeInfo.error) {
      Message.error(effectsErrors.getNodeInfo.error.message);
    }
  }, [effectsErrors.getNodeInfo.error]);

  const TERM_ID = 'node';
  const steps = [
    { title: '选择版本', name: 'selectedVersion' },
    { title: '安装 Node.js', name: 'installNode' },
    { title: '重装全局依赖', name: 'reinstallPackages' },
    { title: '完成', name: 'finish' },
  ];
  const field = Field.useField({ values: defaultValues });
  const formItemLayout = {
    labelCol: {
      fixedSpan: 10,
    },
    wrapperCol: {
      span: 14,
    },
  };

  const writeChunk = (
    e: IpcRendererEvent,
    data: { chunk: string; ln?: boolean },
  ) => {
    const { chunk, ln } = data;
    const xterm = xtermManager.getTerm(TERM_ID);
    if (xterm) {
      xterm.writeChunk(chunk, ln);
    }
  };

  const goNext = () => {
    const { node } = store.getState();
    dispatchers.updateStep(node.currentStep + 1);
  };

  const submit = async () => {
    const { errors } = await field.validatePromise();
    if (errors) {
      return;
    }
    const values = field.getValues() as object;
    const xterm = xtermManager.getTerm(TERM_ID);
    if (xterm) {
      xterm.clear(TERM_ID);
    }
    dispatchers.updateNodeInstallFormValue(values);
    await ipcRenderer.invoke(
      'install-node',
      {
        managerName,
        ...values,
        installChannel: INSTALL_NODE_CHANNEL,
        processChannel: INSTALL_PROCESS_STATUS_CHANNEL,
      },
    );
    goNext();
  };

  let mainbody: JSX.Element;

  switch (currentStep) {
    case 0:
      mainbody = (
        <Form
          {...formItemLayout}
          field={field}
          fullWidth
          onChange={dispatchers.updateNodeInstallFormValue}
        >
          <Form.Item
            label="Node 版本"
            required
            requiredMessage="请选择一个 Node 版本"
          >
            <Select
              name="nodeVersion"
              placeholder="请选择一个 Node 版本"
              showSearch
            >
              {
                nodeVersions.majors.map(({ version, title }) => (
                  <Select.Option key={version} value={version}>{title}</Select.Option>
                ))
              }
            </Select>
          </Form.Item>
          <Form.Item
            label={
              <span className={styles.label}>
                重装全局依赖
                <Balloon type="primary" trigger={<Icon type="help" size="medium" />} closable={false}>
                  安装一个新版本的 Node.js 后，原来全局 npm 包可能会不可用。
                  选择此选项会自动把原来的 npm 包适配到新版本的 Node.js 中。
                </Balloon>
              </span>}
            required
            requiredMessage="请选择是否重装全局依赖"
          >
            <Switch name="reinstallGlobalDeps" />
          </Form.Item>
          <Form.Item label=" " className={styles.submitBtn}>
            <Form.Submit type="primary" onClick={submit} validate>
              下一步
            </Form.Submit>
          </Form.Item>
        </Form>
      );
      break;
    case 1:
    case 2:
      mainbody = (
        <div className={styles.term}>
          <XtermTerminal id={TERM_ID} name={TERM_ID} options={{ rows: 30 }} />
        </div>
      );
      break;
    case 3:
      mainbody = <InstallResult goBack={goBack} reinstallGlobalDeps={nodeInstallFormValue.reinstallGlobalDeps} />;
      break;
    default:
      break;
  }

  const stepComponents = steps.map(
    (item, index) => (
      <Step.Item
        className={styles.stepItem}
        aria-current={index === currentStep ? 'step' : null}
        key={item.name}
        title={item.title}
        disabled={index === 2 && !nodeInstallFormValue.reinstallGlobalDeps}
        icon={
          ((index === 1 || index === 2) && currentStep === index) ? STEP_STATUS_ICON[nodeInstallStatus[item.name]] : undefined
        }
      />
    ),
  );

  useEffect(() => {
    dispatchers.getNodeVersions();
  }, []);

  useEffect(() => {
    if (nodeInstallVisible) {
      dispatchers.getCaches({ installChannel: INSTALL_NODE_CHANNEL, processChannel: INSTALL_PROCESS_STATUS_CHANNEL });
    }
  }, []);

  useEffect(() => {
    ipcRenderer.on(INSTALL_NODE_CHANNEL, writeChunk);
    return () => {
      ipcRenderer.removeListener(INSTALL_NODE_CHANNEL, writeChunk);
    };
  }, []);

  function handleUpdateInstallStatus(e: IpcRendererEvent, { task, status, errMsg, result }) {
    if (status === 'done') {
      return;
    }
    dispatchers.updateNodeInstallStatus({ status, stepName: task });
    if (status === 'process') {
      return;
    } else if (status === 'error') {
      dispatchers.updateNodeInstallErrMsg({ errMsg, stepName: task });
    } else if (status === 'success' && result) {
      dispatchers.updateInstallResult(result);
    }
    goNext();
  }

  useEffect(() => {
    ipcRenderer.on(INSTALL_PROCESS_STATUS_CHANNEL, handleUpdateInstallStatus);
    return () => {
      ipcRenderer.removeListener(
        INSTALL_PROCESS_STATUS_CHANNEL,
        handleUpdateInstallStatus,
      );
    };
  }, []);
  return (
    <div className={styles.installStepContainer}>
      <Step current={currentStep} className={styles.step} shape="dot">
        {stepComponents}
      </Step>
      <Loading visible={effectsLoading.getNodeVersions} className={styles.loading} tip="获取 Node.js 版本中...">
        {mainbody}
      </Loading>
    </div>
  );
};

export default InstallStep;
