import { DataTypes } from 'sequelize';
import { AppDataSource } from '../config';

export const Question = AppDataSource.define(
  'question',
  {
    id: {
      type: DataTypes.INTEGER,
      primaryKey: true,
      autoIncrement: true,
    },
    x_id: {
      type: DataTypes.STRING,
      allowNull: false,
    },
    identifier: {
      type: DataTypes.STRING,
      allowNull: false,
      unique: true,
    },
    benchmark_time: {
      type: DataTypes.INTEGER,
      allowNull: false,
    },
    question_type: {
      type: DataTypes.STRING,
      allowNull: false,
    },
    operation: {
      type: DataTypes.STRING,
      allowNull: false,
    },
    name: {
      type: DataTypes.JSONB,
      allowNull: true,
    },
    description: {
      type: DataTypes.JSONB,
      allowNull: true,
    },
    tenant: {
      type: DataTypes.JSONB,
      allowNull: true,
    },
    repository: {
      type: DataTypes.JSONB,
      allowNull: true,
    },
    taxonomy: {
      type: DataTypes.JSONB,
      allowNull: false,
    },
    gradient: {
      type: DataTypes.STRING,
      allowNull: true,
    },
    hints: {
      type: DataTypes.JSONB,
      allowNull: true,
    },
    status: {
      type: DataTypes.ENUM('draft', 'live'),
      allowNull: false,
    },
    media: {
      type: DataTypes.JSONB,
      allowNull: true,
    },
    question_body: {
      type: DataTypes.JSONB,
      allowNull: false,
    },
    sub_skills: {
      type: DataTypes.JSONB,
      allowNull: true,
    },
    created_by: {
      type: DataTypes.STRING,
      allowNull: false,
    },
    updated_by: {
      type: DataTypes.STRING,
      allowNull: true,
    },
    is_active: {
      type: DataTypes.BOOLEAN,
      allowNull: false,
      defaultValue: true,
    },
  },
  {
    tableName: 'question',
    timestamps: true,
    createdAt: 'created_at',
    updatedAt: 'updated_at',
  },
);
