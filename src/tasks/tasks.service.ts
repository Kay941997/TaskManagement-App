/* eslint-disable @typescript-eslint/no-inferrable-types */
/* eslint-disable prettier/prettier */
import { CACHE_MANAGER, ConflictException, HttpException, HttpStatus, Inject, Injectable, InternalServerErrorException, NotFoundException } from '@nestjs/common';
// import { v4 as uuid } from 'uuid'; //tạo id ngẫu nhiên
import { CreateTaskDto } from './dto/createTask.dto';
import { GetTasksSearchFilterDto } from './dto/getTasksSearchFilter.dto';
import { TaskRepository } from './task.repository';
import { InjectRepository } from '@nestjs/typeorm';
import { TaskEntity } from './entity/task.entity';
import { TaskStatus } from './taskStatus.enum';
import { UpdateTaskDto } from './dto/updateTask.dto';
import { getRepository, Repository, UpdateResult } from 'typeorm';
import { UserEntity } from 'src/auth/entity/user.entity';
import { CategoryEntity } from 'src/categories/entity/category.entity';
import { ForbiddenError } from '@casl/ability';
import { Action } from 'src/casl/casl-action.enum';
import { CaslAbilityFactory } from 'src/casl/casl-ability.factory';
import { TaskToCategoryEntity } from './entity/taskToCategory.entity';
import { CategoriesService } from 'src/categories/categories.service';
import { Cache } from 'cache-manager';
import { GET_CACHE_KEY } from 'src/cacheManully/cacheKey.constant';
import { from, Observable } from 'rxjs';

import {
  paginate,
  Pagination,
  IPaginationOptions,
} from 'nestjs-typeorm-paginate';

@Injectable()
export class TasksService {
  constructor (
    @InjectRepository(TaskRepository)
    private taskRepository: TaskRepository,

    private caslAbilityFactory: CaslAbilityFactory, //CASL Role

    // @Inject(CACHE_MANAGER) //!(Cache Manually) 
    // private cacheManager: Cache

  ) {}

  // //!Clear: (Cache Manually)
  // async clearCache() { //Clear Cache when Create Update Delete
  //   const keys: string[] = await this.cacheManager.store.keys();
  //   keys.forEach((key) => {
  //     if (key.startsWith(GET_CACHE_KEY)) {
  //       this.cacheManager.del(key);
  //     }
  //   })
  // }

 

 
  //!Create A Task + Relation Database (author + categories):
  async createTask(createTaskDto: CreateTaskDto, author: UserEntity): Promise<TaskEntity> {

    const { title, description, categoryIds } = createTaskDto;
    // const taskNew = new TaskEntity();
    // taskNew.title = title;
    // taskNew.description = description;
    // taskNew.status = TaskStatus.OPEN;
    // taskNew.author = author;
    // taskNew.taskToCategory = [] ; //todo: ManyToMany Advanced Relation Xem lai

    const task = this.taskRepository.create(
      createTaskDto
    )

    task.author = author
    task.taskToCategories = []; //Tạo Task chứa Categories rỗng:
    const newTask = await task.save();


    //todo: Tạo 2 categories giống nhau, trả về 1 category:
    const arr = [];
    for(let i = 0; i<categoryIds.length; i++){
      if(arr.indexOf(categoryIds[i]) === -1)
        arr.push(categoryIds[i])
    }
    console.log(arr)
    
    //Tạo Task chứa Categories có giá trị:
    for (let i = 0; i < arr.length; i++) {
      const category = await getRepository(CategoryEntity).findOne(arr[i]);

      if (category) {

        const taskToCategory = new TaskToCategoryEntity();
        taskToCategory.taskId = newTask.id
        taskToCategory.categoryId = category.id

        task.taskToCategories.push(taskToCategory); 
      }
    }

    await task.save()
    // await this.clearCache(); //!Cache Manually
    return task;

  }

  //!Get All Tasks + Get All Tasks Search Filter:
  async getTasksSearchFilter(filterDto: GetTasksSearchFilterDto): Promise<TaskEntity[]> {
    const { status, search } = filterDto;
    const query = this.taskRepository
      .createQueryBuilder('task') //!TypeOrm Query Builder
      .orderBy("task.id")
      .leftJoinAndSelect('task.taskToCategories', 'category');
      
    if (status) {
      query.andWhere('task.status = :status', { status });
    }
    if (search) {
      query.andWhere(
        '(task.title LIKE :search OR task.description LIKE :search)',
        { search: `%${search}%` },
      );
    }

    const tasks = await query.getMany();
    return tasks;
  }


  // //!Pagination Infinite Scroll:
  // getTasksSelected(take: number = 10, skip: number = 0): Promise<TaskEntity[]> {
  //     return (this.taskRepository.findAndCount({take, skip}).then(([tasks]) => {
  //       return <TaskEntity[]>tasks
  //     }))
  // }

  // //!Pagination Infinite Scroll:
  // getTasksSelected(take: number = 10, skip: number = 0): Promise<TaskEntity[]> {
  //   return (
  //     this.taskRepository
  //       .createQueryBuilder('task')
  //       .innerJoinAndSelect('task.author', 'author')
  //       .orderBy('task.createdAt', 'DESC') //todo: Mới nhất đến cũ nhất
  //       .take(take)
  //       .skip(skip)
  //       .getMany()
  //   )
  // }

  //!Pagination: (Phân trang)
  async paginate(options: IPaginationOptions): Promise<Pagination<TaskEntity>> {
    const queryBuilder = this.taskRepository.createQueryBuilder('task');
    queryBuilder.orderBy('task.createdAt', 'DESC'); //todo: Mới nhất đến cũ nhất

    return paginate<TaskEntity>(queryBuilder, options);
  }


  //!Get Task By Id:
  async getTaskById(id: number): Promise<TaskEntity> {
    const taskFound = await this.taskRepository.findOne(id, {relations: ['author', 'taskToCategories']});
   
    if (!taskFound) { //Error Handle:
      throw new NotFoundException(`Task with ID ${id} not found !`);
    } else {

      // console.log(this.cacheManager.get('key'))
      return taskFound;
    }
   
  }

  // //!Update Task Status:
  // async updateTaskStatus(id: number, status: TaskStatus): Promise<TaskEntity> {
  //   const task = await this.getTaskById(id);
  //   task.status = status;
  //   await task.save();
  //   return task;
  // }

  //!Update Task use CASL Role:
  async updateTask (id: number, updateTaskDto: UpdateTaskDto, user:UserEntity) : Promise<TaskEntity> {

    //todo: CASL isAdmin isCreator:
    const caslAbility = this.caslAbilityFactory.createForUser(user)
    const taskToUpdate = await this.getTaskById(id);
      ForbiddenError.from(caslAbility)
        .setMessage('only admin or creator!')
        .throwUnlessCan(Action.Update, taskToUpdate);

    const updatedTask = await this.taskRepository.findOne(id, {relations: ['author']})

    const { title, description, categoryIds } = updateTaskDto;

    updatedTask.title = title;
    updatedTask.description = description;

    updatedTask.taskToCategories = [] ; //!ManyToMany Relation Xem lai
    for (let i = 0; i < categoryIds.length; i++) {
      const category = await getRepository(CategoryEntity).findOne(categoryIds[i]);
      console.log(category)

      if (category) {
        const updateTaskToCategory = new TaskToCategoryEntity();
        updateTaskToCategory.taskId = updatedTask.id
        updateTaskToCategory.categoryId = category.id

        updatedTask.taskToCategories.push(updateTaskToCategory);
      } else {
        throw new HttpException('Category Not Found', HttpStatus.NOT_FOUND);
      }
    }

    await updatedTask.save();
    // await this.clearCache(); //!Cache Manually
    return updatedTask;
  }

  //!Delete Task use CASL Role:
  async deleteTask(id: number): Promise<void> {
    const result = await this.taskRepository.delete(id);
    if (result.affected === 0) { //Error Handle:
      throw new NotFoundException(`Task with ID ${id} is not found !`);
    }
    // await this.clearCache(); //!Cache Manually
  }
}
