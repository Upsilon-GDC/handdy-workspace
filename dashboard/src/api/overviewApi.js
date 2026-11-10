import axiosInstance from './axiosInstance';
import { createSharedRead } from '../utils/overviewData';

export const getWorkingHoursOverview = createSharedRead(
  async params => (await axiosInstance.get('/working-hours/overview', { params, timeout: 10_000 })).data,
  () => localStorage.getItem('token') || '',
);
export const getTeamWorkingHoursOverview = createSharedRead(
  async params => (await axiosInstance.get('/working-hours/team-overview', { params, timeout: 10_000 })).data,
  () => localStorage.getItem('token') || '',
);
