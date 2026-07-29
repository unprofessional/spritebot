import { StatTemplateDAO } from '../dao/stat_template.dao';
import type {
  CreateCustomStatDefinitionParams,
  CustomStatDefinition,
} from '../types/stat_template';
import { isValidCustomStatKey } from '../utils/custom_stat_key';

const statTemplateDAO = new StatTemplateDAO();

export async function createCustomStatDefinition(
  input: CreateCustomStatDefinitionParams,
): Promise<CustomStatDefinition> {
  if (!isValidCustomStatKey(input.stat_key)) {
    throw new Error(
      'Stat key must start with a lowercase letter and contain only lowercase letters, numbers, or underscores (64 characters maximum).',
    );
  }
  return statTemplateDAO.create(input);
}
