import React, { useState, useCallback, useRef } from 'react';
import { 
  Plus, 
  Trash2, 
  Play, 
  Save, 
  Settings,
  GitBranch,
  RotateCcw,
  CheckCircle,
  AlertCircle,
  ArrowRight,
  GripVertical,
} from 'lucide-react';

interface WorkflowStep {
  id: string;
  name: string;
  type: 'task' | 'condition' | 'parallel' | 'loop' | 'wait' | 'notification';
  config: Record<string, unknown>;
  next?: string;
  onError?: string;
  timeout?: number;
}

interface WorkflowVariable {
  name: string;
  type: 'string' | 'number' | 'boolean' | 'array' | 'object';
  default?: unknown;
  required: boolean;
}

interface WorkflowDesignerProps {
  initialWorkflow?: {
    id: string;
    name: string;
    description: string;
    steps: WorkflowStep[];
    variables: WorkflowVariable[];
  };
  onSave?: (workflow: {
    id: string;
    name: string;
    description: string;
    steps: WorkflowStep[];
    variables: WorkflowVariable[];
  }) => void;
  onRun?: (workflowId: string, variables: Record<string, unknown>) => void;
}

const STEP_TYPES = [
  { id: 'task', label: 'Task', icon: CheckCircle, color: 'blue' },
  { id: 'condition', label: 'Condition', icon: GitBranch, color: 'amber' },
  { id: 'parallel', label: 'Parallel', icon: ArrowRight, color: 'purple' },
  { id: 'loop', label: 'Loop', icon: RotateCcw, color: 'cyan' },
  { id: 'wait', label: 'Wait', icon: AlertCircle, color: 'orange' },
  { id: 'notification', label: 'Notify', icon: AlertCircle, color: 'green' },
] as const;

export function WorkflowDesigner({ 
  initialWorkflow,
  onSave,
  onRun 
}: WorkflowDesignerProps) {
  const [workflow, setWorkflow] = useState({
    id: initialWorkflow?.id || `wf-${Date.now()}`,
    name: initialWorkflow?.name || 'New Workflow',
    description: initialWorkflow?.description || '',
    steps: initialWorkflow?.steps || [],
    variables: initialWorkflow?.variables || [],
  });
  
  const [selectedStepId, setSelectedStepId] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState<'design' | 'variables' | 'preview'>('design');
  const [isRunning, setIsRunning] = useState(false);
  const dragItem = useRef<{ index: number } | null>(null);

  const selectedStep = workflow.steps.find(s => s.id === selectedStepId);

  const addStep = useCallback((type: WorkflowStep['type']) => {
    const newStep: WorkflowStep = {
      id: `step-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
      name: `New ${type} step`,
      type,
      config: {},
    };

    setWorkflow(prev => {
      const steps = [...prev.steps];
      // Link previous step to new step
      if (steps.length > 0) {
        steps[steps.length - 1].next = newStep.id;
      }
      steps.push(newStep);
      return { ...prev, steps };
    });
    
    setSelectedStepId(newStep.id);
  }, []);

  const removeStep = useCallback((stepId: string) => {
    setWorkflow(prev => {
      const steps = prev.steps.filter(s => s.id !== stepId);
      // Re-link steps
      for (let i = 0; i < steps.length - 1; i++) {
        steps[i].next = steps[i + 1].id;
      }
      if (steps.length > 0) {
        delete steps[steps.length - 1].next;
      }
      return { ...prev, steps };
    });
    
    if (selectedStepId === stepId) {
      setSelectedStepId(null);
    }
  }, [selectedStepId]);

  const updateStep = useCallback((stepId: string, updates: Partial<WorkflowStep>) => {
    setWorkflow(prev => ({
      ...prev,
      steps: prev.steps.map(s => 
        s.id === stepId ? { ...s, ...updates } : s
      ),
    }));
  }, []);

  const moveStep = useCallback((dragIndex: number, hoverIndex: number) => {
    setWorkflow(prev => {
      const steps = [...prev.steps];
      const [removed] = steps.splice(dragIndex, 1);
      steps.splice(hoverIndex, 0, removed);
      
      // Re-link steps
      for (let i = 0; i < steps.length - 1; i++) {
        steps[i].next = steps[i + 1].id;
      }
      if (steps.length > 0) {
        delete steps[steps.length - 1].next;
      }
      
      return { ...prev, steps };
    });
  }, []);

  const handleDragStart = useCallback((index: number) => {
    dragItem.current = { index };
  }, []);

  const handleDragOver = useCallback((e: React.DragEvent, index: number) => {
    e.preventDefault();
    if (dragItem.current && dragItem.current.index !== index) {
      moveStep(dragItem.current.index, index);
      dragItem.current.index = index;
    }
  }, [moveStep]);

  const handleSave = useCallback(() => {
    onSave?.(workflow);
  }, [workflow, onSave]);

  const handleRun = useCallback(async () => {
    if (!onRun) return;
    
    setIsRunning(true);
    try {
      // Build variables from defaults
      const vars: Record<string, unknown> = {};
      for (const v of workflow.variables) {
        if (v.default !== undefined) {
          vars[v.name] = v.default;
        }
      }
      
      await onRun(workflow.id, vars);
    } finally {
      setIsRunning(false);
    }
  }, [workflow, onRun]);

  const addVariable = useCallback(() => {
    setWorkflow(prev => ({
      ...prev,
      variables: [
        ...prev.variables,
        {
          name: `var${prev.variables.length + 1}`,
          type: 'string',
          required: false,
        },
      ],
    }));
  }, []);

  const updateVariable = useCallback((index: number, updates: Partial<WorkflowVariable>) => {
    setWorkflow(prev => {
      const variables = [...prev.variables];
      variables[index] = { ...variables[index], ...updates };
      return { ...prev, variables };
    });
  }, []);

  const removeVariable = useCallback((index: number) => {
    setWorkflow(prev => ({
      ...prev,
      variables: prev.variables.filter((_, i) => i !== index),
    }));
  }, []);

  return (
    <div className="flex h-full bg-slate-900">
      {/* Left sidebar - Toolbox */}
      <div className="w-64 bg-slate-800 border-r border-slate-700 flex flex-col">
        <div className="p-4 border-b border-slate-700">
          <h3 className="text-sm font-medium text-slate-200 mb-3">Add Step</h3>
          <div className="space-y-2">
            {STEP_TYPES.map(type => {
              const Icon = type.icon;
              return (
                <button
                  key={type.id}
                  onClick={() => addStep(type.id as WorkflowStep['type'])}
                  className={`w-full flex items-center gap-3 px-3 py-2 rounded-lg text-sm
                    bg-slate-700 hover:bg-slate-600 text-slate-200 
                    transition-colors border border-transparent
                    hover:border-${type.color}-500/50`}
                >
                  <Icon className={`w-4 h-4 text-${type.color}-400`} />
                  <span>{type.label}</span>
                  <Plus className="w-4 h-4 ml-auto text-slate-400" />
                </button>
              );
            })}
          </div>
        </div>

        <div className="p-4">
          <h3 className="text-sm font-medium text-slate-200 mb-3">Workflow Info</h3>
          <div className="space-y-3">
            <div>
              <label className="block text-xs text-slate-400 mb-1">Name</label>
              <input
                type="text"
                value={workflow.name}
                onChange={(e) => setWorkflow(prev => ({ ...prev, name: e.target.value }))}
                className="w-full px-3 py-2 bg-slate-700 border border-slate-600 rounded-md 
                  text-sm text-slate-200 focus:outline-none focus:border-blue-500"
              />
            </div>
            <div>
              <label className="block text-xs text-slate-400 mb-1">Description</label>
              <textarea
                value={workflow.description}
                onChange={(e) => setWorkflow(prev => ({ ...prev, description: e.target.value }))}
                rows={3}
                className="w-full px-3 py-2 bg-slate-700 border border-slate-600 rounded-md 
                  text-sm text-slate-200 focus:outline-none focus:border-blue-500 resize-none"
              />
            </div>
          </div>
        </div>

        <div className="mt-auto p-4 border-t border-slate-700 space-y-2">
          <button
            onClick={handleSave}
            className="w-full flex items-center justify-center gap-2 px-4 py-2 
              bg-blue-600 hover:bg-blue-500 text-white rounded-lg text-sm
              transition-colors"
          >
            <Save className="w-4 h-4" />
            Save Workflow
          </button>
          <button
            onClick={handleRun}
            disabled={isRunning || workflow.steps.length === 0}
            className="w-full flex items-center justify-center gap-2 px-4 py-2 
              bg-green-600 hover:bg-green-500 disabled:bg-slate-700 
              disabled:text-slate-500 text-white rounded-lg text-sm
              transition-colors"
          >
            <Play className="w-4 h-4" />
            {isRunning ? 'Running...' : 'Run Workflow'}
          </button>
        </div>
      </div>

      {/* Center - Step List */}
      <div className="flex-1 flex flex-col">
        {/* Tabs */}
        <div className="flex border-b border-slate-700">
          {(['design', 'variables', 'preview'] as const).map(tab => (
            <button
              key={tab}
              onClick={() => setActiveTab(tab)}
              className={`px-6 py-3 text-sm font-medium capitalize
                ${activeTab === tab 
                  ? 'text-blue-400 border-b-2 border-blue-400' 
                  : 'text-slate-400 hover:text-slate-200'}`}
            >
              {tab}
            </button>
          ))}
        </div>

        {/* Tab Content */}
        <div className="flex-1 overflow-auto p-6">
          {activeTab === 'design' && (
            <div className="space-y-4">
              {workflow.steps.length === 0 ? (
                <div className="text-center py-12 text-slate-500">
                  <Settings className="w-12 h-12 mx-auto mb-4 opacity-50" />
                  <p>Click a step type on the left to add your first step</p>
                </div>
              ) : (
                workflow.steps.map((step, index) => {
                  const stepType = STEP_TYPES.find(t => t.id === step.type);
                  const Icon = stepType?.icon || Settings;
                  const isSelected = selectedStepId === step.id;

                  return (
                    <div
                      key={step.id}
                      draggable
                      onDragStart={() => handleDragStart(index)}
                      onDragOver={(e) => handleDragOver(e, index)}
                      onDragEnd={() => { dragItem.current = null; }}
                      onClick={() => setSelectedStepId(step.id)}
                      className={`group flex items-center gap-3 p-4 rounded-lg border-2 
                        cursor-pointer transition-all
                        ${isSelected 
                          ? 'border-blue-500 bg-blue-500/10' 
                          : 'border-slate-700 bg-slate-800 hover:border-slate-600'}`}
                    >
                      <GripVertical className="w-5 h-5 text-slate-600 cursor-move" />
                      
                      <div className={`w-10 h-10 rounded-lg flex items-center justify-center
                        bg-${stepType?.color}-500/20`}
                      >
                        <Icon className={`w-5 h-5 text-${stepType?.color}-400`} />
                      </div>

                      <div className="flex-1">
                        <div className="flex items-center gap-2">
                          <span className="text-sm font-medium text-slate-200">
                            {step.name}
                          </span>
                          <span className="text-xs text-slate-500 capitalize">
                            ({step.type})
                          </span>
                        </div>
                        <div className="text-xs text-slate-500 mt-1">
                          {step.next ? `→ Next: ${workflow.steps.find(s => s.id === step.next)?.name || step.next}` : 'End'}
                        </div>
                      </div>

                      <button
                        onClick={(e) => {
                          e.stopPropagation();
                          removeStep(step.id);
                        }}
                        className="opacity-0 group-hover:opacity-100 p-2 text-slate-500 
                          hover:text-red-400 transition-opacity"
                      >
                        <Trash2 className="w-4 h-4" />
                      </button>
                    </div>
                  );
                })
              )}
            </div>
          )}

          {activeTab === 'variables' && (
            <div className="space-y-4">
              <div className="flex justify-between items-center">
                <h3 className="text-sm font-medium text-slate-200">Workflow Variables</h3>
                <button
                  onClick={addVariable}
                  className="flex items-center gap-2 px-3 py-1.5 bg-blue-600 hover:bg-blue-500 
                    text-white rounded-lg text-sm transition-colors"
                
                  >
                  <Plus className="w-4 h-4" />
                  Add Variable
                </button>
              </div>

              {workflow.variables.length === 0 ? (
                <div className="text-center py-8 text-slate-500">
                  No variables defined
                </div>
              ) : (
                <div className="space-y-3">
                  {workflow.variables.map((variable, index) => (
                    <div
                      key={index}
                      className="flex items-center gap-3 p-4 bg-slate-800 rounded-lg border border-slate-700"
                    >
                      <input
                        type="text"
                        value={variable.name}
                        onChange={(e) => updateVariable(index, { name: e.target.value })}
                        placeholder="Variable name"
                        className="flex-1 px-3 py-2 bg-slate-700 border border-slate-600 
                          rounded-md text-sm text-slate-200 focus:outline-none focus:border-blue-500"
                      />

                      <select
                        value={variable.type}
                        onChange={(e) => updateVariable(index, { type: e.target.value as WorkflowVariable['type'] })}
                        className="px-3 py-2 bg-slate-700 border border-slate-600 
                          rounded-md text-sm text-slate-200 focus:outline-none focus:border-blue-500"
                      >
                        <option value="string">String</option>
                        <option value="number">Number</option>
                        <option value="boolean">Boolean</option>
                        <option value="array">Array</option>
                        <option value="object">Object</option>
                      </select>

                      <label className="flex items-center gap-2 text-sm text-slate-400">
                        <input
                          type="checkbox"
                          checked={variable.required}
                          onChange={(e) => updateVariable(index, { required: e.target.checked })}
                          className="rounded border-slate-600 bg-slate-700"
                        />
                        Required
                      </label>

                      <button
                        onClick={() => removeVariable(index)}
                        className="p-2 text-slate-500 hover:text-red-400"
                      >
                        <Trash2 className="w-4 h-4" />
                      </button>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}

          {activeTab === 'preview' && (
            <div className="space-y-4">
              <div className="bg-slate-800 rounded-lg p-4 border border-slate-700">
                <h4 className="text-sm font-medium text-slate-200 mb-2">Workflow JSON</h4>
                <pre className="text-xs text-slate-400 overflow-auto max-h-96">
                  {JSON.stringify(workflow, null, 2)}
                </pre>
              </div>
            </div>
          )}
        </div>
      </div>

      {/* Right panel - Step configuration */}
      {selectedStep && activeTab === 'design' && (
        <div className="w-80 bg-slate-800 border-l border-slate-700 p-4 overflow-auto">
          <h3 className="text-sm font-medium text-slate-200 mb-4">Step Configuration</h3>
          
          <div className="space-y-4">
            <div>
              <label className="block text-xs text-slate-400 mb-1">Name</label>
              <input
                type="text"
                value={selectedStep.name}
                onChange={(e) => updateStep(selectedStep.id, { name: e.target.value })}
                className="w-full px-3 py-2 bg-slate-700 border border-slate-600 
                  rounded-md text-sm text-slate-200 focus:outline-none focus:border-blue-500"
              />
            </div>

            <div>
              <label className="block text-xs text-slate-400 mb-1">Timeout (seconds)</label>
              <input
                type="number"
                value={selectedStep.timeout || ''}
                onChange={(e) => updateStep(selectedStep.id, { 
                  timeout: e.target.value ? parseInt(e.target.value) : undefined 
                })}
                placeholder="No timeout"
                className="w-full px-3 py-2 bg-slate-700 border border-slate-600 
                  rounded-md text-sm text-slate-200 focus:outline-none focus:border-blue-500"
              />
            </div>

            <div>
              <label className="block text-xs text-slate-400 mb-1">On Error</label>
              <select
                value={selectedStep.onError || ''}
                onChange={(e) => updateStep(selectedStep.id, { 
                  onError: e.target.value || undefined 
                })}
                className="w-full px-3 py-2 bg-slate-700 border border-slate-600 
                  rounded-md text-sm text-slate-200 focus:outline-none focus:border-blue-500"
              >
                <option value="">Stop workflow</option>
                {workflow.steps
                  .filter(s => s.id !== selectedStep.id)
                  .map(s => (
                    <option key={s.id} value={s.id}>Go to: {s.name}</option>
                  ))}
              </select>
            </div>

            <div className="border-t border-slate-700 pt-4">
              <h4 className="text-xs font-medium text-slate-400 mb-3">Type-specific Config</h4>
              
              {selectedStep.type === 'task' && (
                <div className="space-y-3">
                  <div>
                    <label className="block text-xs text-slate-400 mb-1">Task ID</label>
                    <input
                      type="text"
                      value={(selectedStep.config.taskId as string) || ''}
                      onChange={(e) => updateStep(selectedStep.id, {
                        config: { ...selectedStep.config, taskId: e.target.value }
                      })}
                      className="w-full px-3 py-2 bg-slate-700 border border-slate-600 
                        rounded-md text-sm text-slate-200"
                    />
                  </div>
                  
                  <label className="flex items-center gap-2 text-sm text-slate-400">
                    <input
                      type="checkbox"
                      checked={(selectedStep.config.useOrchestration as boolean) !== false}
                      onChange={(e) => updateStep(selectedStep.id, {
                        config: { ...selectedStep.config, useOrchestration: e.target.checked }
                      })}
                      className="rounded border-slate-600 bg-slate-700"
                    />
                    Use skill orchestration
                  </label>
                </div>
              )}

              {selectedStep.type === 'condition' && (
                <div className="space-y-3">
                  <div>
                    <label className="block text-xs text-slate-400 mb-1">Condition</label>
                    <input
                      type="text"
                      value={(selectedStep.config.condition as string) || ''}
                      onChange={(e) => updateStep(selectedStep.id, {
                        config: { ...selectedStep.config, condition: e.target.value }
                      })}
                      placeholder="e.g., ${status} === 'ready'"
                      className="w-full px-3 py-2 bg-slate-700 border border-slate-600 
                        rounded-md text-sm text-slate-200"
                    />
                  </div>
                  
                  <div>
                    <label className="block text-xs text-slate-400 mb-1">If True</label>
                    <select
                      value={(selectedStep.config.trueNext as string) || ''}
                      onChange={(e) => updateStep(selectedStep.id, {
                        config: { ...selectedStep.config, trueNext: e.target.value }
                      })}
                      className="w-full px-3 py-2 bg-slate-700 border border-slate-600 
                        rounded-md text-sm text-slate-200"
                    >
                      <option value="">Continue</option>
                      {workflow.steps
                        .filter(s => s.id !== selectedStep.id)
                        .map(s => (
                          <option key={s.id} value={s.id}>{s.name}</option>
                        ))}
                    </select>
                  </div>
                  
                  <div>
                    <label className="block text-xs text-slate-400 mb-1">If False</label>
                    <select
                      value={(selectedStep.config.falseNext as string) || ''}
                      onChange={(e) => updateStep(selectedStep.id, {
                        config: { ...selectedStep.config, falseNext: e.target.value }
                      })}
                      className="w-full px-3 py-2 bg-slate-700 border border-slate-600 
                        rounded-md text-sm text-slate-200"
                    >
                      <option value="">Continue</option>
                      {workflow.steps
                        .filter(s => s.id !== selectedStep.id)
                        .map(s => (
                          <option key={s.id} value={s.id}>{s.name}</option>
                        ))}
                    </select>
                  </div>
                </div>
              )}

              {selectedStep.type === 'wait' && (
                <div className="space-y-3">
                  <div>
                    <label className="block text-xs text-slate-400 mb-1">Duration (seconds)</label>
                    <input
                      type="number"
                      value={(selectedStep.config.duration as number) || ''}
                      onChange={(e) => updateStep(selectedStep.id, {
                        config: { 
                          ...selectedStep.config, 
                          duration: e.target.value ? parseInt(e.target.value) : undefined 
                        }
                      })}
                      className="w-full px-3 py-2 bg-slate-700 border border-slate-600 
                        rounded-md text-sm text-slate-200"
                    />
                  </div>
                </div>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
