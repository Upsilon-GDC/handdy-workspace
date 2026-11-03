import axiosInstance from './axiosInstance';
export const getEntryForEdit = async id => (await axiosInstance.get(`/time-logs/entries/${encodeURIComponent(id)}/edit`)).data;
export const saveEntryEdit = async (id, body) => (await axiosInstance.patch(`/time-logs/entries/${encodeURIComponent(id)}`, body)).data;
