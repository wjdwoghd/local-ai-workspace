import { expect, it } from 'vitest';
import { chatModels } from '../../src/models';

it('offers only Sol and Astra by default, with Sol first in both server modes', () => {
  expect(chatModels({}).map(({id,label})=>({id,label}))).toEqual([
    { id: 'gpt-6.1-sol', label: 'GPT-6.1 Sol' },
    { id: 'gpt-6-astra', label: 'Astra' },
  ]);
  expect(chatModels({ OPENAI_ASTRA_MODEL_ID: 'gpt-6-astra', OPENAI_ADDITIONAL_MODELS: '[]' })[0].id).toBe('gpt-6.1-sol');
});

it('honors explicit server defaults without duplicating Astra or accepting invalid models', () => {
  expect(chatModels({ OPENAI_MODEL_ID: 'gpt-6-astra' }).map(({id,label})=>({id,label}))).toEqual([{ id: 'gpt-6-astra', label: 'Astra' }, {id:'gpt-6.1-sol',label:'GPT-6.1 Sol'}]);
  expect(chatModels({ OPENAI_MODEL_LABEL: 'Sol' })[0].label).toBe('Sol');
  for (const id of ['demo', 'invalid/model']) expect(() => chatModels({ OPENAI_MODEL_ID: id })).toThrow();
  expect(() => chatModels({ OPENAI_MODEL_LABEL: 'x'.repeat(51) })).toThrow();
  expect(() => chatModels({ OPENAI_ADDITIONAL_MODELS: '[{"id":"gpt-6.1-sol","label":"duplicate"}]' })).toThrow();
});
it('advertises verified levels for both built-ins and requires explicit capabilities for custom IDs',()=>{
  for(const model of chatModels({}))expect(model.reasoningEfforts).toEqual(['low','medium','high','xhigh','max','ultra']);
  expect(chatModels({OPENAI_MODEL_ID:'custom'})[0].reasoningEfforts).toEqual([]);
  expect(()=>chatModels({OPENAI_ADDITIONAL_MODELS:JSON.stringify([{id:'custom',label:'Custom',reasoningEfforts:['ultra']}])})).toThrow();
});
