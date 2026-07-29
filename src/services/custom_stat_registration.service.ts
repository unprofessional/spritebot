import { CustomStatRegistrationDAO } from '../dao/custom_stat_registration.dao';
import type {
  CustomStatDefinition,
  CustomStatRegistrationResult,
  RegisterCustomStatDefinitionParams,
} from '../types/stat_template';

const registrationDAO = new CustomStatRegistrationDAO();

export async function listCustomStatDefinitions(gameId: string): Promise<CustomStatDefinition[]> {
  return registrationDAO.listByGame(gameId);
}

export async function registerCustomStatDefinition(
  input: RegisterCustomStatDefinitionParams,
): Promise<CustomStatRegistrationResult> {
  return registrationDAO.register(input);
}
