import type { TextWorkflow, WorkflowStep } from './types';

export const DEFAULT_WORKFLOWS: TextWorkflow[] = [
    {
        id: 'polish',
        name: 'Вычитать и улучшить',
        steps: [
            { id: 'spellcheck', name: 'Исправить ошибки', mode: 'spellcheck' },
            { id: 'style', name: 'Улучшить стиль', mode: 'style' },
        ],
    },
    {
        id: 'concise',
        name: 'Чисто и короче',
        steps: [
            { id: 'spellcheck', name: 'Исправить ошибки', mode: 'spellcheck' },
            {
                id: 'shorter',
                name: 'Сократить',
                mode: 'custom',
                prompt: 'Сделай текст короче и яснее, сохранив факты, смысл и язык исходного текста. Верни только результат.',
            },
        ],
    },
    {
        id: 'publish',
        name: 'Подготовить к публикации',
        steps: [
            { id: 'spellcheck', name: 'Исправить ошибки', mode: 'spellcheck' },
            { id: 'style', name: 'Улучшить стиль', mode: 'style' },
            {
                id: 'structure',
                name: 'Оформить',
                mode: 'custom',
                prompt: 'Оформи текст для удобного чтения: сохрани язык и смысл, добавь абзацы и списки только там, где это уместно. Верни только готовый текст.',
            },
        ],
    },
];

const VALID_MODES = new Set<WorkflowStep['mode']>(['spellcheck', 'style', 'emoji', 'translate', 'custom']);

export function normalizeWorkflows(value: unknown): TextWorkflow[] {
    if (!Array.isArray(value)) return DEFAULT_WORKFLOWS;
    const workflows = value
        .filter((item): item is Partial<TextWorkflow> => Boolean(item && typeof item === 'object'))
        .map((workflow, workflowIndex) => ({
            id: String(workflow.id || `workflow-${workflowIndex}`).slice(0, 100),
            name: String(workflow.name || 'Без названия')
                .trim()
                .slice(0, 60),
            steps: Array.isArray(workflow.steps)
                ? workflow.steps
                      .filter((step) => Boolean(step && typeof step === 'object'))
                      .filter((step) => VALID_MODES.has(step.mode as WorkflowStep['mode']))
                      .map((step, stepIndex) => ({
                          id: String(step.id || `step-${stepIndex}`).slice(0, 100),
                          name: String(step.name || 'Шаг')
                              .trim()
                              .slice(0, 60),
                          mode: step.mode as WorkflowStep['mode'],
                          ...(step.mode === 'custom'
                              ? {
                                    prompt: String(step.prompt || '')
                                        .trim()
                                        .slice(0, 2000),
                                }
                              : {}),
                      }))
                      .filter((step) => step.mode !== 'custom' || step.prompt)
                      .slice(0, 8)
                : [],
        }))
        .filter((workflow) => workflow.name && workflow.steps.length)
        .slice(0, 12);
    return workflows.length ? workflows : DEFAULT_WORKFLOWS;
}
