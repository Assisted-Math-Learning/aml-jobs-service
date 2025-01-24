import { DataTypes } from 'sequelize';
import { AppDataSource } from '../config';

export const AudioStage = AppDataSource.define(
  'audio_stage',
  {
    id: {
      type: DataTypes.INTEGER,
      primaryKey: true,
      autoIncrement: true,
    },
    process_id: {
      type: DataTypes.UUID,
      allowNull: true,
    },
    question_id: {
      type: DataTypes.STRING,
      allowNull: true,
    },
    audio_description: {
      type: DataTypes.STRING,
      allowNull: true,
    },
    language: {
      type: DataTypes.STRING,
      allowNull: true,
    },
    status: {
      type: DataTypes.ENUM('progress', 'errored', 'success'),
      allowNull: true,
    },
    error_info: {
      type: DataTypes.JSON,
      allowNull: true,
    },
    created_by: {
      type: DataTypes.STRING,
      allowNull: true,
    },
    updated_by: {
      type: DataTypes.STRING,
      allowNull: true,
    },
  },
  {
    tableName: 'audio_stage',
    timestamps: true,
    createdAt: 'created_at',
    updatedAt: 'updated_at',
  },
);
