import { CustomStatValueDAO } from '../dao/custom_stat_value.dao';
import type {
  ApplyCustomStatValueInput,
  ApplyCustomStatValueResult,
  CustomStatValueState,
  CustomStatValueTargetType,
} from '../types/custom_stat_value';

const customStatValueDAO = new CustomStatValueDAO();

export async function applyCustomStatValue(
  input: ApplyCustomStatValueInput,
): Promise<ApplyCustomStatValueResult> {
  return customStatValueDAO.apply(input);
}

export async function getCustomStatValueState(input: {
  gameId: string;
  targetType: CustomStatValueTargetType;
  targetId: string;
  templateId: string;
}): Promise<CustomStatValueState | null> {
  return customStatValueDAO.getState(input);
}
