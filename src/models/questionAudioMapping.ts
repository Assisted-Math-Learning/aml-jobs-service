import { DataTypes } from 'sequelize';
import { AppDataSource } from '../config';

export const AudioQuestionMapping = AppDataSource.define(
  'audio_question_mapping',
  {
    id: {
      type: DataTypes.INTEGER,
      primaryKey: true,
      autoIncrement: true,
    },
    question_id: {
      type: DataTypes.STRING,
      allowNull: false,
    },
    audio_id: {
      type: DataTypes.STRING,
      allowNull: false,
    },
    language: {
      type: DataTypes.STRING,
      allowNull: false,
    },
    created_by: {
      type: DataTypes.STRING,
      allowNull: false,
    },
    updated_by: {
      type: DataTypes.STRING,
      allowNull: true,
    },
  },
  {
    tableName: 'audio_question_mapping',
    timestamps: true,
    createdAt: 'created_at',
    updatedAt: 'updated_at',
  },
);
